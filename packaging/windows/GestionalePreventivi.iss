#define AppName "Gestionale Preventivi"
#define AppVersion "1.0.0"
#define AppExeName "GestionalePreventivi.exe"

[Setup]
AppId={{2A1F8B7C-0E51-48A1-965E-941B4C2376A0}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Area Tenda
DefaultDirName={autopf}\Gestionale Preventivi
DefaultGroupName={#AppName}
OutputDir=..\..\dist-installer
OutputBaseFilename=Gestionale Preventivi 1.0 Setup
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
  Result := RegQueryStringValue(HKLM64, Key, 'pv', Version) and IsRuntimeVersionValid(Version);
  if not Result then
    Result := RegQueryStringValue(HKCU64, Key, 'pv', Version) and IsRuntimeVersionValid(Version);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not IsWebView2Installed then
    Result := 'Per avviare il gestionale è necessario Microsoft Edge WebView2 Runtime.' + #13#10 + #13#10 +
      'Installa il runtime Evergreen dal sito Microsoft, quindi riavvia il setup:' + #13#10 +
      'https://developer.microsoft.com/microsoft-edge/webview2/';
end;
