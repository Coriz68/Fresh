import threading
import time
import unittest

from desktop_app import CloseCoordinator


class FakeWindow:
    def __init__(self, result=True, callback=True, block=False):
        self.result = result
        self.deliver_callback = callback
        self.block = block
        self.started = threading.Event()
        self.release = threading.Event()
        self.destroyed = threading.Event()
        self.evaluate_calls = 0

    def evaluate_js(self, script, callback=None):
        self.evaluate_calls += 1
        self.started.set()
        if self.block:
            self.release.wait(2)
        if self.deliver_callback and callback:
            callback(self.result)

    def destroy(self):
        self.destroyed.set()


def wait_until(predicate, timeout=1):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


class CloseCoordinatorTests(unittest.TestCase):
    def test_native_close_waits_for_successful_flush_then_destroys_window(self):
        window = FakeWindow(result=True)
        coordinator = CloseCoordinator(window, timeout_seconds=0.2)

        self.assertFalse(coordinator.on_closing())
        self.assertTrue(window.destroyed.wait(1))
        self.assertTrue(coordinator.on_closing())
        self.assertEqual(window.evaluate_calls, 1)

    def test_failed_flush_keeps_window_open_and_allows_retry(self):
        window = FakeWindow(result=False)
        coordinator = CloseCoordinator(window, timeout_seconds=0.2)

        self.assertFalse(coordinator.on_closing())
        self.assertTrue(wait_until(lambda: not coordinator.pending))
        self.assertFalse(coordinator.allowed)
        window.result = True
        self.assertFalse(coordinator.on_closing())
        self.assertTrue(window.destroyed.wait(1))
        self.assertEqual(window.evaluate_calls, 2)

    def test_missing_callback_times_out_and_allows_a_new_attempt(self):
        window = FakeWindow(callback=False)
        coordinator = CloseCoordinator(window, timeout_seconds=0.05)

        self.assertFalse(coordinator.on_closing())
        self.assertTrue(wait_until(lambda: not coordinator.pending))
        window.deliver_callback = True
        self.assertFalse(coordinator.on_closing())
        self.assertTrue(window.destroyed.wait(1))
        self.assertEqual(window.evaluate_calls, 2)

    def test_duplicate_close_attempts_do_not_launch_parallel_flushes(self):
        window = FakeWindow(callback=False)
        coordinator = CloseCoordinator(window, timeout_seconds=0.05)

        self.assertFalse(coordinator.on_closing())
        self.assertFalse(coordinator.on_closing())
        self.assertTrue(window.started.wait(1))
        self.assertEqual(window.evaluate_calls, 1)
        self.assertTrue(wait_until(lambda: not coordinator.pending))


if __name__ == "__main__":
    unittest.main()
