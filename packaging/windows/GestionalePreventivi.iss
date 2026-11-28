#define AppName "Gestionale Preventivi"
#define AppVersion "1.0.12"
#define AppExeName "GestionalePreventivi.exe"

[Setup]
AppId={{2A1F8B7C-0E51-48A1-965E-941B4C2376A0}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=CorradoWEB 2026
DefaultDirName={autopf}\Gestionale Preventivi
DefaultGroupName={#AppName}
OutputDir=..\..\dist-installer
OutputBaseFilename=Gestionale Preventivi 1.0.12 Setup
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExeName}
SetupLogging=yes
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"

[Tasks]
Name: "desktopicon"; Description: "Crea un collegamento sul desktop"; GroupDescription: "Collegamenti aggiuntivi:"; Flags: unchecked

[Files]
Source: "..\..\dist\GestionalePreventivi\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "MicrosoftEdgeWebView2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{group}\Gestionale Preventivi"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\Gestionale Preventivi"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Avvia Gestionale Preventivi"; Flags: postinstall nowait skipifsilent

[Code]
const
  WebView2ClientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function IsRuntimeVersionValid(const Version: string): Boolean;
begin
  Result := (Version <> '') and (Version <> '0.0.0.0');
end;

function IsWebView2Installed: Boolean;
var
  Version: string;
  Key: string;
begin
  Key := 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2ClientId;
  { Microsoft registers the 64-bit Evergreen Runtime in the 32-bit registry
    view (WOW6432Node), while per-user installations use the normal user view. }
  Result := RegQueryStringValue(HKLM32, Key, 'pv', Version) and IsRuntimeVersionValid(Version);
  if not Result then
    Result := RegQueryStringValue(HKCU64, Key, 'pv', Version) and IsRuntimeVersionValid(Version);
  { Also accept the alternate views in case a device has legacy registration. }
  if not Result then
    Result := RegQueryStringValue(HKLM64, Key, 'pv', Version) and IsRuntimeVersionValid(Version);
  if not Result then
    Result := RegQueryStringValue(HKCU32, Key, 'pv', Version) and IsRuntimeVersionValid(Version);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if not IsWebView2Installed then
  begin
    WizardForm.StatusLabel.Caption := 'Installazione del componente Microsoft WebView2...';
    WizardForm.Update;
    ExtractTemporaryFile('MicrosoftEdgeWebView2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      Result := 'Non è stato possibile avviare l’installazione di Microsoft WebView2.' + #13#10 + #13#10 +
        'Riprova come amministratore e verifica la connessione Internet.'
    else if not IsWebView2Installed then
      Result := 'Microsoft WebView2 non è stato installato (codice ' + IntToStr(ExitCode) + ').' + #13#10 + #13#10 +
        'Verifica la connessione Internet e riprova. Il programma non è stato installato.';
  end;
end;
