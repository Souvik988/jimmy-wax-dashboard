# Builds a double-click-friendly pack of the three session prompts: one HTML page (tabs + Copy buttons, works offline) and plain .txt files.
# Usage: powershell -File tools\build-prompt-pages.ps1 [-Out "C:\path\to\folder"]
param([string]$Out = 'C:\Users\MSI\OneDrive\Desktop\JIMMY_WAX_PROMPTS')
$src = Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\build\handoff'
$utf8 = New-Object Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force $Out | Out-Null

$items = @(
  @{ id = 'backend';  label = '1. Backend';  file = 'BACKEND_SESSION_PROMPT.md';  txt = '1_BACKEND_prompt.txt';  where = 'the Claude Code session opened in the jimmy&wax_backend folder' },
  @{ id = 'website';  label = '2. Website';  file = 'WEBSITE_SESSION_PROMPT.md';  txt = '2_WEBSITE_prompt.txt';  where = 'the Claude Code session opened in the jimmy_nd _wax_website folder' },
  @{ id = 'app';      label = '3. App';      file = 'APP_SESSION_PROMPT.md';      txt = '3_APP_prompt.txt';      where = 'the Claude Code session opened in the jimmy&wax_app folder' }
)
$tabs = ''; $panels = ''
foreach ($it in $items) {
  $text = [IO.File]::ReadAllText((Join-Path $src $it.file), $utf8)
  [IO.File]::WriteAllText((Join-Path $Out $it.txt), $text, $utf8)
  $esc = [Net.WebUtility]::HtmlEncode($text)
  $tabs += "<button class='tab' data-id='$($it.id)'>$($it.label)</button>"
  $panels += "<section class='panel' id='p-$($it.id)'><p class='where'>Paste this into <b>$([Net.WebUtility]::HtmlEncode($it.where))</b>.</p><div class='bar'><button class='copy' data-id='$($it.id)'>Copy whole prompt</button><span class='ok' id='ok-$($it.id)'></span></div><textarea id='t-$($it.id)' readonly spellcheck='false'>$esc</textarea></section>"
}
$html = @"
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JIMMY and WAX session prompts</title>
<style>
:root{--bg:#faf7f2;--fg:#1d1a16;--muted:#6b645b;--card:#fff;--line:#e3ddd2;--acc:#8a5a2b}
@media (prefers-color-scheme:dark){:root{--bg:#161412;--fg:#f1ece4;--muted:#a79f93;--card:#201d1a;--line:#38332d;--acc:#d9a05b}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
h1{margin:0 0 4px;font-size:1.6rem} .sub{color:var(--muted);margin:0 0 20px}
.steps{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 18px;margin-bottom:18px}
.steps ol{margin:6px 0 0;padding-left:20px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.tab,.copy{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:10px 16px;border-radius:10px;cursor:pointer}
.tab[aria-selected=true]{background:var(--acc);color:#fff;border-color:var(--acc)}
.copy{background:var(--acc);color:#fff;border-color:var(--acc);font-weight:600}
.copy:focus-visible,.tab:focus-visible{outline:3px solid var(--fg);outline-offset:2px}
.panel{display:none}.panel.on{display:block}
.where{margin:0 0 8px}.bar{display:flex;gap:12px;align-items:center;margin-bottom:8px}.ok{color:var(--acc);font-weight:600}
textarea{width:100%;height:62vh;box-sizing:border-box;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--fg);font:13px/1.55 ui-monospace,Consolas,monospace;resize:vertical}
</style></head><body><main>
<h1>JIMMY and WAX: prompts for the three other sessions</h1>
<p class="sub">No passwords or API keys are inside. Wherever a value is needed the prompt shows a placeholder like &lt;VALUE&gt;; fill real values only in your server's secret manager.</p>
<div class="steps"><b>How to use</b><ol>
<li>Open the Claude Code session for the project named on the tab (Backend, Website or App).</li>
<li>Press <b>Copy whole prompt</b> on that tab, then paste it into the chat and send.</li>
<li>Do the <b>Backend</b> one first: the other two depend on the contract changes it makes.</li></ol></div>
<div class="tabs" role="tablist">$tabs</div>
$panels
<script>
const tabs=[...document.querySelectorAll('.tab')],panels=[...document.querySelectorAll('.panel')];
function show(id){tabs.forEach(t=>t.setAttribute('aria-selected',t.dataset.id===id));panels.forEach(p=>p.classList.toggle('on',p.id==='p-'+id));}
tabs.forEach(t=>t.addEventListener('click',()=>show(t.dataset.id)));show('backend');
document.querySelectorAll('.copy').forEach(b=>b.addEventListener('click',async()=>{
  const ta=document.getElementById('t-'+b.dataset.id),ok=document.getElementById('ok-'+b.dataset.id);
  try{await navigator.clipboard.writeText(ta.value);ok.textContent='Copied. Now paste it into the session.';}
  catch(e){ta.focus();ta.select();ok.textContent='Selected. Press Ctrl+C to copy.';}
}));
</script></main></body></html>
"@
[IO.File]::WriteAllText((Join-Path $Out 'OPEN_ME_prompts.html'), $html, $utf8)
Get-ChildItem $Out | Select-Object Name, @{n='KB';e={[math]::Round($_.Length/1KB,1)}}
