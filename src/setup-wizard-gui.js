#!/usr/bin/env node

/**
 * AiAdminBot Native GUI Setup Wizard v1.0
 *
 * Uses PowerShell + .NET Windows Forms to display a native Windows wizard.
 * Falls back to CLI wizard if PowerShell is unavailable (Linux/Mac/old Windows).
 *
 * Flow:
 *   1. Generates a PowerShell script with a multi-step wizard form
 *   2. Runs it via child_process
 *   3. Reads the JSON result from a temp file
 *   4. Validates the Discord token
 *   5. Writes the .env file
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, spawn } = require('child_process');

// ── Paths ────────────────────────────────────────────────────────────────────

function getBasePath() {
  if (process.pkg) return path.dirname(process.execPath);
  return path.join(__dirname, '..');
}

const basePath = getBasePath();
const envPath = path.join(basePath, '.env');
const tmpResultPath = path.join(basePath, '_setup_result.json');

// ── Debug log to file ────────────────────────────────────────────────────────
const debugLogPath = path.join(basePath, '_setup_debug.log');
function debugLog(...args) {
  const line = '[GUI ' + new Date().toISOString() + '] ' + args.join(' ') + '\n';
  try { fs.appendFileSync(debugLogPath, line); } catch { /* ignore */ }
}

// ── Token validation (same as CLI wizard) ────────────────────────────────────

function validateToken(token) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'discord.com',
      path: '/api/v10/users/@me',
      method: 'GET',
      headers: {
        'Authorization': `Bot ${token}`,
        'User-Agent': 'AiAdminBot-Setup',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const user = JSON.parse(data);
            resolve({ valid: true, username: user.username, id: user.id });
          } catch {
            resolve({ valid: false });
          }
        } else {
          resolve({ valid: false });
        }
      });
    });

    req.on('error', () => resolve({ valid: false }));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ valid: false });
    });
    req.end();
  });
}

// ── PowerShell Windows Forms Wizard ──────────────────────────────────────────

function generatePowerShellScript(resultPath, guidePath) {
  // Escape backslashes for PowerShell string
  const psResultPath = resultPath.replace(/\\/g, '\\\\');
  const psGuidePath = (guidePath || '').replace(/\\/g, '\\\\');

  // Build script as array of lines to avoid JS template literal escaping issues
  // ALL strings must be pure ASCII — PowerShell reads .ps1 with system codepage
  const lines = [];
  const L = (s) => lines.push(s);

  L('Add-Type -AssemblyName System.Windows.Forms');
  L('Add-Type -AssemblyName System.Drawing');
  L('');
  L('[System.Windows.Forms.Application]::EnableVisualStyles()');
  L('');
  L('# Color Palette');
  L('$BgColor       = [System.Drawing.Color]::FromArgb(30, 30, 46)');
  L('$PanelBg       = [System.Drawing.Color]::FromArgb(40, 40, 60)');
  L('$AccentColor   = [System.Drawing.Color]::FromArgb(88, 101, 242)');
  L('$TextColor     = [System.Drawing.Color]::White');
  L('$DimColor      = [System.Drawing.Color]::FromArgb(160, 160, 180)');
  L('$InputBg       = [System.Drawing.Color]::FromArgb(50, 50, 70)');
  L('$GreenColor    = [System.Drawing.Color]::FromArgb(87, 242, 135)');
  L('$ErrorColor    = [System.Drawing.Color]::FromArgb(237, 66, 69)');
  L('');
  L('# Fonts');
  L('$TitleFont   = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)');
  L('$HeadFont    = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)');
  L('$BodyFont    = New-Object System.Drawing.Font("Segoe UI", 10)');
  L('$SmallFont   = New-Object System.Drawing.Font("Segoe UI", 9)');
  L('$InputFont   = New-Object System.Drawing.Font("Consolas", 11)');
  L('$BtnFont     = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)');
  L('');
  L('# Setup guide images path');
  L('$guidePath = "' + psGuidePath + '"');
  L('');
  L('# Main Form');
  L('$form = New-Object System.Windows.Forms.Form');
  L('$form.Text = "AiAdminBot - Setup Wizard"');
  L('$form.Size = New-Object System.Drawing.Size(620, 700)');
  L('$form.StartPosition = "CenterScreen"');
  L('$form.FormBorderStyle = "FixedDialog"');
  L('$form.MaximizeBox = $false');
  L('$form.BackColor = $BgColor');
  L('$form.ForeColor = $TextColor');
  L('$form.Font = $BodyFont');
  L('');
  L('# Result holder');
  L('$script:result = @{');
  L('  token = ""');
  L('  locale = "tr"');
  L('  aiProvider = "skip"');
  L('  openrouterKey = ""');
  L('  geminiKey = ""');
  L('  aiChat = $false');
  L('  aiMod = $false');
  L('  webPort = ""');
  L('  webPassword = ""');
  L('  cancelled = $true');
  L('}');
  L('');
  L('$script:currentStep = 0');
  L('$totalSteps = 5');
  L('$panels = @()');
  L('');
  L('# Helper: styled label');
  L('function New-StyledLabel {');
  L('  param($text, $x, $y, $width, $height, $font, $color)');
  L('  $lbl = New-Object System.Windows.Forms.Label');
  L('  $lbl.Text = $text');
  L('  $lbl.Location = New-Object System.Drawing.Point($x, $y)');
  L('  $lbl.Size = New-Object System.Drawing.Size($width, $height)');
  L('  $lbl.Font = if ($font) { $font } else { $BodyFont }');
  L('  $lbl.ForeColor = if ($color) { $color } else { $TextColor }');
  L('  $lbl.BackColor = [System.Drawing.Color]::Transparent');
  L('  return $lbl');
  L('}');
  L('');
  L('# Helper: styled textbox');
  L('function New-StyledInput {');
  L('  param($x, $y, $width, $isPassword)');
  L('  $txt = New-Object System.Windows.Forms.TextBox');
  L('  $txt.Location = New-Object System.Drawing.Point($x, $y)');
  L('  $txt.Size = New-Object System.Drawing.Size($width, 30)');
  L('  $txt.Font = $InputFont');
  L('  $txt.BackColor = $InputBg');
  L('  $txt.ForeColor = $TextColor');
  L('  $txt.BorderStyle = "FixedSingle"');
  L('  if ($isPassword) { $txt.UseSystemPasswordChar = $true }');
  L('  return $txt');
  L('}');
  L('');
  L('# Helper: styled button');
  L('function New-StyledButton {');
  L('  param($text, $x, $y, $width, $primary)');
  L('  $btn = New-Object System.Windows.Forms.Button');
  L('  $btn.Text = $text');
  L('  $btn.Location = New-Object System.Drawing.Point($x, $y)');
  L('  $btn.Size = New-Object System.Drawing.Size($width, 38)');
  L('  $btn.Font = $BtnFont');
  L('  $btn.FlatStyle = "Flat"');
  L('  $btn.FlatAppearance.BorderSize = 0');
  L('  $btn.Cursor = "Hand"');
  L('  if ($primary) {');
  L('    $btn.BackColor = $AccentColor');
  L('    $btn.ForeColor = $TextColor');
  L('  } else {');
  L('    $btn.BackColor = $PanelBg');
  L('    $btn.ForeColor = $DimColor');
  L('  }');
  L('  return $btn');
  L('}');
  L('');
  L('# Helper: load guide image into PictureBox');
  L('function New-GuideImage {');
  L('  param($filename, $x, $y, $width, $height)');
  L('  $imgPath = [System.IO.Path]::Combine($guidePath, $filename)');
  L('  if ([System.IO.File]::Exists($imgPath)) {');
  L('    $pb = New-Object System.Windows.Forms.PictureBox');
  L('    $pb.Location = New-Object System.Drawing.Point($x, $y)');
  L('    $pb.Size = New-Object System.Drawing.Size($width, $height)');
  L('    $pb.SizeMode = "Zoom"');
  L('    $pb.BackColor = $PanelBg');
  L('    try {');
  L('      $pb.Image = [System.Drawing.Image]::FromFile($imgPath)');
  L('    } catch { }');
  L('    return $pb');
  L('  }');
  L('  return $null');
  L('}');
  L('');
  L('# Helper: clickable link label');
  L('function New-LinkLabel {');
  L('  param($text, $url, $x, $y, $width, $height)');
  L('  $link = New-Object System.Windows.Forms.LinkLabel');
  L('  $link.Text = $text');
  L('  $link.Location = New-Object System.Drawing.Point($x, $y)');
  L('  $link.Size = New-Object System.Drawing.Size($width, $height)');
  L('  $link.Font = $SmallFont');
  L('  $link.LinkColor = $AccentColor');
  L('  $link.ActiveLinkColor = $GreenColor');
  L('  $link.VisitedLinkColor = $AccentColor');
  L('  $link.BackColor = [System.Drawing.Color]::Transparent');
  L('  $link.Tag = $url');
  L('  $link.Add_LinkClicked({');
  L('    param($sender, $e)');
  L('    try { Start-Process $sender.Tag } catch { }');
  L('  })');
  L('  return $link');
  L('}');
  L('');
  L('# Progress bar (top)');
  L('$progressPanel = New-Object System.Windows.Forms.Panel');
  L('$progressPanel.Location = New-Object System.Drawing.Point(0, 0)');
  L('$progressPanel.Size = New-Object System.Drawing.Size(620, 60)');
  L('$progressPanel.BackColor = $PanelBg');
  L('');
  L('$stepLabel = New-Object System.Windows.Forms.Label');
  L('$stepLabel.Location = New-Object System.Drawing.Point(20, 15)');
  L('$stepLabel.Size = New-Object System.Drawing.Size(560, 30)');
  L('$stepLabel.Font = $HeadFont');
  L('$stepLabel.ForeColor = $TextColor');
  L('$stepLabel.BackColor = [System.Drawing.Color]::Transparent');
  L('');
  L('$progressBar = New-Object System.Windows.Forms.Panel');
  L('$progressBar.Location = New-Object System.Drawing.Point(0, 54)');
  L('$progressBar.Size = New-Object System.Drawing.Size(0, 6)');
  L('$progressBar.BackColor = $AccentColor');
  L('');
  L('$progressPanel.Controls.Add($stepLabel)');
  L('$progressPanel.Controls.Add($progressBar)');
  L('$form.Controls.Add($progressPanel)');
  L('');
  L('# Navigation buttons');
  L('$btnBack = New-StyledButton "< Back" 20 615 110 $false');
  L('$btnNext = New-StyledButton "Next >" 475 615 110 $true');
  L('$btnCancel = New-StyledButton "Cancel" 250 615 110 $false');
  L('');
  L('$form.Controls.Add($btnBack)');
  L('$form.Controls.Add($btnNext)');
  L('$form.Controls.Add($btnCancel)');
  L('');
  L('# STEP 0: Welcome');
  L('$p0 = New-Object System.Windows.Forms.Panel');
  L('$p0.Location = New-Object System.Drawing.Point(0, 60)');
  L('$p0.Size = New-Object System.Drawing.Size(620, 550)');
  L('$p0.BackColor = $BgColor');
  L('');
  L('$p0.Controls.Add((New-StyledLabel "Welcome to AiAdminBot Setup" 30 30 540 40 $TitleFont $TextColor))');
  L('$p0.Controls.Add((New-StyledLabel "This wizard will help you configure your Discord admin bot." 30 80 540 25 $BodyFont $DimColor))');
  L('$p0.Controls.Add((New-StyledLabel "You will need:" 30 120 540 25 $BodyFont $TextColor))');
  L('$p0.Controls.Add((New-StyledLabel "- A Discord Bot Token (from Developer Portal)" 50 150 520 25 $BodyFont $DimColor))');
  L('$p0.Controls.Add((New-StyledLabel "- (Optional) An API key for AI features" 50 175 520 25 $BodyFont $DimColor))');
  L('$p0.Controls.Add((New-StyledLabel "- (Optional) A password for the web dashboard" 50 200 520 25 $BodyFont $DimColor))');
  L('$p0.Controls.Add((New-StyledLabel "Click Next to begin." 30 260 540 25 $BodyFont $GreenColor))');
  L('');
  L('$panels += $p0');
  L('');
  L('# STEP 1: Discord Bot Token');
  L('$p1 = New-Object System.Windows.Forms.Panel');
  L('$p1.Location = New-Object System.Drawing.Point(0, 60)');
  L('$p1.Size = New-Object System.Drawing.Size(620, 550)');
  L('$p1.BackColor = $BgColor');
  L('');
  L('$p1.Controls.Add((New-StyledLabel "Discord Bot Token" 30 15 540 30 $HeadFont $TextColor))');
  L('');
  L('# Clickable link to Discord Developer Portal');
  L('$devPortalLink = New-LinkLabel "Open Discord Developer Portal" "https://discord.com/developers/applications" 30 50 300 20');
  L('$p1.Controls.Add($devPortalLink)');
  L('$p1.Controls.Add((New-StyledLabel "Go to Bot tab > Reset Token > Copy and paste below:" 30 72 540 20 $SmallFont $DimColor))');
  L('');
  L('$tokenInput = New-StyledInput 30 105 545 $true');
  L('$p1.Controls.Add($tokenInput)');
  L('');
  L('$tokenStatus = New-StyledLabel "" 30 142 545 20 $SmallFont $DimColor');
  L('$p1.Controls.Add($tokenStatus)');
  L('');
  L('$chkShowToken = New-Object System.Windows.Forms.CheckBox');
  L('$chkShowToken.Text = "Show token"');
  L('$chkShowToken.Location = New-Object System.Drawing.Point(30, 168)');
  L('$chkShowToken.Size = New-Object System.Drawing.Size(200, 25)');
  L('$chkShowToken.Font = $SmallFont');
  L('$chkShowToken.ForeColor = $DimColor');
  L('$chkShowToken.BackColor = [System.Drawing.Color]::Transparent');
  L('$chkShowToken.Add_CheckedChanged({');
  L('  $tokenInput.UseSystemPasswordChar = -not $chkShowToken.Checked');
  L('})');
  L('$p1.Controls.Add($chkShowToken)');
  L('');
  L('# Guide image for Step 1');
  L('$img1 = New-GuideImage "step1-token.png" 30 205 545 310');
  L('if ($img1) { $p1.Controls.Add($img1) }');
  L('');
  L('$panels += $p1');
  L('');
  L('# STEP 2: Language');
  L('$p2 = New-Object System.Windows.Forms.Panel');
  L('$p2.Location = New-Object System.Drawing.Point(0, 60)');
  L('$p2.Size = New-Object System.Drawing.Size(620, 550)');
  L('$p2.BackColor = $BgColor');
  L('');
  L('$p2.Controls.Add((New-StyledLabel "Select Language" 30 15 540 30 $HeadFont $TextColor))');
  L('$p2.Controls.Add((New-StyledLabel "Choose the language for bot messages and channel names:" 30 50 540 20 $SmallFont $DimColor))');
  L('');
  L('$langList = New-Object System.Windows.Forms.ListBox');
  L('$langList.Location = New-Object System.Drawing.Point(30, 85)');
  L('$langList.Size = New-Object System.Drawing.Size(545, 200)');
  L('$langList.Font = New-Object System.Drawing.Font("Segoe UI", 12)');
  L('$langList.BackColor = $InputBg');
  L('$langList.ForeColor = $TextColor');
  L('$langList.BorderStyle = "FixedSingle"');
  L('$langList.Items.AddRange(@(');
  L('  "tr  -  Turkce (Turkish)",');
  L('  "en  -  English",');
  L('  "de  -  Deutsch (German)",');
  L('  "es  -  Espanol (Spanish)",');
  L('  "fr  -  Francais (French)",');
  L('  "pt  -  Portugues (Portuguese)",');
  L('  "ru  -  Russian",');
  L('  "ar  -  Arabic"');
  L('))');
  L('$langList.SelectedIndex = 0');
  L('$p2.Controls.Add($langList)');
  L('');
  L('$langPreview = New-StyledLabel "" 30 295 545 40 $SmallFont $DimColor');
  L('$p2.Controls.Add($langPreview)');
  L('');
  L('$langPreviews = @{');
  L('  0 = "Channels: #dogrulama  #hos-geldin  #kurallar  #genel-sohbet  #ai-sohbet"');
  L('  1 = "Channels: #verification  #welcome  #rules  #general-chat  #ai-chat"');
  L('  2 = "Channels: #verifizierung  #willkommen  #regeln  #allgemein-chat  #ki-chat"');
  L('  3 = "Channels: #verificacion  #bienvenida  #reglas  #chat-general  #ia-chat"');
  L('  4 = "Channels: #verification  #bienvenue  #regles  #discussion-generale  #ia-chat"');
  L('  5 = "Channels: #verificacao  #boas-vindas  #regras  #bate-papo-geral  #ia-chat"');
  L('  6 = "Channels: #verification  #welcome  #rules  #general-chat  #ai-chat"');
  L('  7 = "Channels: #verification  #welcome  #rules  #general-chat  #ai-chat"');
  L('}');
  L('');
  L('$langList.Add_SelectedIndexChanged({');
  L('  $langPreview.Text = $langPreviews[$langList.SelectedIndex]');
  L('})');
  L('$langPreview.Text = $langPreviews[0]');
  L('');
  L('$panels += $p2');
  L('');
  L('# STEP 3: AI Features');
  L('$p3 = New-Object System.Windows.Forms.Panel');
  L('$p3.Location = New-Object System.Drawing.Point(0, 60)');
  L('$p3.Size = New-Object System.Drawing.Size(620, 550)');
  L('$p3.BackColor = $BgColor');
  L('');
  L('$p3.Controls.Add((New-StyledLabel "AI Features (Optional)" 30 15 540 30 $HeadFont $TextColor))');
  L('$p3.Controls.Add((New-StyledLabel "Add AI-powered chat and smart moderation to your bot." 30 50 540 20 $SmallFont $DimColor))');
  L('');
  L('$p3.Controls.Add((New-StyledLabel "OpenRouter API Key:" 30 85 200 20 $BodyFont $TextColor))');
  L('$orLink = New-LinkLabel "Get free key at openrouter.ai/keys" "https://openrouter.ai/keys" 230 85 340 20');
  L('$p3.Controls.Add($orLink)');
  L('$orKeyInput = New-StyledInput 30 110 545 $false');
  L('$p3.Controls.Add($orKeyInput)');
  L('');
  L('$p3.Controls.Add((New-StyledLabel "Google Gemini API Key:" 30 155 200 20 $BodyFont $TextColor))');
  L('$gemLink = New-LinkLabel "Get free key at aistudio.google.com" "https://aistudio.google.com/apikey" 230 155 340 20');
  L('$p3.Controls.Add($gemLink)');
  L('$gemKeyInput = New-StyledInput 30 180 545 $false');
  L('$p3.Controls.Add($gemKeyInput)');
  L('');
  L('$chkAiChat = New-Object System.Windows.Forms.CheckBox');
  L('$chkAiChat.Text = "Enable AI Chat Assistant"');
  L('$chkAiChat.Location = New-Object System.Drawing.Point(30, 230)');
  L('$chkAiChat.Size = New-Object System.Drawing.Size(250, 25)');
  L('$chkAiChat.Font = $BodyFont');
  L('$chkAiChat.ForeColor = $TextColor');
  L('$chkAiChat.BackColor = [System.Drawing.Color]::Transparent');
  L('$chkAiChat.Checked = $true');
  L('$p3.Controls.Add($chkAiChat)');
  L('');
  L('$chkAiMod = New-Object System.Windows.Forms.CheckBox');
  L('$chkAiMod.Text = "Enable AI Smart Moderation"');
  L('$chkAiMod.Location = New-Object System.Drawing.Point(30, 260)');
  L('$chkAiMod.Size = New-Object System.Drawing.Size(250, 25)');
  L('$chkAiMod.Font = $BodyFont');
  L('$chkAiMod.ForeColor = $TextColor');
  L('$chkAiMod.BackColor = [System.Drawing.Color]::Transparent');
  L('$chkAiMod.Checked = $true');
  L('$p3.Controls.Add($chkAiMod)');
  L('');
  L('$p3.Controls.Add((New-StyledLabel "Leave both keys blank to skip AI features." 30 310 540 20 $SmallFont $DimColor))');
  L('');
  L('# Guide image for Step 3');
  L('$img3 = New-GuideImage "step3-ai.png" 30 345 545 170');
  L('if ($img3) { $p3.Controls.Add($img3) }');
  L('');
  L('$panels += $p3');
  L('');
  L('# STEP 4: Web Dashboard');
  L('$p4 = New-Object System.Windows.Forms.Panel');
  L('$p4.Location = New-Object System.Drawing.Point(0, 60)');
  L('$p4.Size = New-Object System.Drawing.Size(620, 550)');
  L('$p4.BackColor = $BgColor');
  L('');
  L('$p4.Controls.Add((New-StyledLabel "Web Dashboard" 30 15 540 30 $HeadFont $TextColor))');
  L('$p4.Controls.Add((New-StyledLabel "Access moderation logs, roles, and settings from your browser." 30 50 540 20 $SmallFont $DimColor))');
  L('');
  L('$chkDashboard = New-Object System.Windows.Forms.CheckBox');
  L('$chkDashboard.Text = "Enable Web Dashboard"');
  L('$chkDashboard.Location = New-Object System.Drawing.Point(30, 85)');
  L('$chkDashboard.Size = New-Object System.Drawing.Size(250, 25)');
  L('$chkDashboard.Font = $BodyFont');
  L('$chkDashboard.ForeColor = $TextColor');
  L('$chkDashboard.BackColor = [System.Drawing.Color]::Transparent');
  L('$chkDashboard.Checked = $true');
  L('$p4.Controls.Add($chkDashboard)');
  L('');
  L('$lblPort = New-StyledLabel "Port:" 30 125 50 25 $BodyFont $TextColor');
  L('$p4.Controls.Add($lblPort)');
  L('');
  L('$portInput = New-StyledInput 80 122 100 $false');
  L('$portInput.Text = "3000"');
  L('$p4.Controls.Add($portInput)');
  L('');
  L('$lblPwd = New-StyledLabel "Dashboard Password:" 30 170 200 25 $BodyFont $TextColor');
  L('$p4.Controls.Add($lblPwd)');
  L('');
  L('$pwdInput = New-StyledInput 30 198 545 $true');
  L('$p4.Controls.Add($pwdInput)');
  L('');
  L('$lblPwdHint = New-StyledLabel "Minimum 4 characters. You will use this to log into the dashboard." 30 235 545 20 $SmallFont $DimColor');
  L('$p4.Controls.Add($lblPwdHint)');
  L('');
  L('$chkShowPwd = New-Object System.Windows.Forms.CheckBox');
  L('$chkShowPwd.Text = "Show password"');
  L('$chkShowPwd.Location = New-Object System.Drawing.Point(30, 260)');
  L('$chkShowPwd.Size = New-Object System.Drawing.Size(200, 25)');
  L('$chkShowPwd.Font = $SmallFont');
  L('$chkShowPwd.ForeColor = $DimColor');
  L('$chkShowPwd.BackColor = [System.Drawing.Color]::Transparent');
  L('$chkShowPwd.Add_CheckedChanged({');
  L('  $pwdInput.UseSystemPasswordChar = -not $chkShowPwd.Checked');
  L('})');
  L('$p4.Controls.Add($chkShowPwd)');
  L('');
  L('$dashErrLabel = New-StyledLabel "" 30 290 545 20 $SmallFont $ErrorColor');
  L('$p4.Controls.Add($dashErrLabel)');
  L('');
  L('# Toggle dashboard fields');
  L('$chkDashboard.Add_CheckedChanged({');
  L('  $enabled = $chkDashboard.Checked');
  L('  $portInput.Enabled = $enabled');
  L('  $pwdInput.Enabled = $enabled');
  L('  $chkShowPwd.Enabled = $enabled');
  L('})');
  L('');
  L('$panels += $p4');
  L('');
  L('# STEP 5: Review & Finish');
  L('$p5 = New-Object System.Windows.Forms.Panel');
  L('$p5.Location = New-Object System.Drawing.Point(0, 60)');
  L('$p5.Size = New-Object System.Drawing.Size(620, 550)');
  L('$p5.BackColor = $BgColor');
  L('');
  L('$p5.Controls.Add((New-StyledLabel "Review Configuration" 30 15 540 30 $HeadFont $TextColor))');
  L('');
  L('$reviewText = New-Object System.Windows.Forms.RichTextBox');
  L('$reviewText.Location = New-Object System.Drawing.Point(30, 55)');
  L('$reviewText.Size = New-Object System.Drawing.Size(545, 250)');
  L('$reviewText.Font = New-Object System.Drawing.Font("Consolas", 11)');
  L('$reviewText.BackColor = $InputBg');
  L('$reviewText.ForeColor = $GreenColor');
  L('$reviewText.BorderStyle = "None"');
  L('$reviewText.ReadOnly = $true');
  L('$p5.Controls.Add($reviewText)');
  L('');
  L('$p5.Controls.Add((New-StyledLabel "Click Finish to save and start the bot." 30 315 540 25 $BodyFont $GreenColor))');
  L('');
  L('$panels += $p5');
  L('');
  L('# Add all panels to form (hidden)');
  L('foreach ($panel in $panels) {');
  L('  $panel.Visible = $false');
  L('  $form.Controls.Add($panel)');
  L('}');
  L('');
  L('# Navigation logic');
  L('$stepTitles = @(');
  L('  "Welcome",');
  L('  "Step 1 of 4 - Discord Bot Token",');
  L('  "Step 2 of 4 - Language",');
  L('  "Step 3 of 4 - AI Features",');
  L('  "Step 4 of 4 - Web Dashboard",');
  L('  "Review & Finish"');
  L(')');
  L('');
  L('$localeCodes = @("tr","en","de","es","fr","pt","ru","ar")');
  L('');
  L('function Show-Step {');
  L('  param($step)');
  L('  for ($i = 0; $i -lt $panels.Count; $i++) {');
  L('    $panels[$i].Visible = ($i -eq $step)');
  L('  }');
  L('  $stepLabel.Text = $stepTitles[$step]');
  L('  $progressBar.Size = New-Object System.Drawing.Size(([int](620 * $step / ($panels.Count - 1))), 6)');
  L('');
  L('  $btnBack.Visible = ($step -gt 0)');
  L('  if ($step -eq ($panels.Count - 1)) {');
  L('    $btnNext.Text = "Finish"');
  L('  } else {');
  L('    $btnNext.Text = "Next >"');
  L('  }');
  L('');
  L('  # Populate review on last step');
  L('  if ($step -eq ($panels.Count - 1)) {');
  L('    $langIdx = $langList.SelectedIndex');
  L('    $langCode = $localeCodes[$langIdx]');
  L('    $langName = $langList.SelectedItem');
  L('');
  L('    $lines = @()');
  L('    $lines += "  Bot Token:      ****" + $tokenInput.Text.Substring([Math]::Max(0, $tokenInput.Text.Length - 6))');
  L('    $lines += "  Language:       $langName"');
  L('    $lines += ""');
  L('');
  L('    if ($orKeyInput.Text.Trim() -or $gemKeyInput.Text.Trim()) {');
  L("      if ($orKeyInput.Text.Trim()) { $lines += '  OpenRouter:     Configured' }");
  L("      if ($gemKeyInput.Text.Trim()) { $lines += '  Gemini:         Configured' }");
  L("      $lines += \"  AI Chat:        $(if ($chkAiChat.Checked) {'Enabled'} else {'Disabled'})\"");
  L("      $lines += \"  AI Moderation:  $(if ($chkAiMod.Checked) {'Enabled'} else {'Disabled'})\"");
  L('    } else {');
  L("      $lines += '  AI Features:    Skipped'");
  L('    }');
  L('');
  L('    $lines += ""');
  L('    if ($chkDashboard.Checked) {');
  L('      $lines += "  Dashboard:      Port $($portInput.Text)"');
  L("      $lines += '  Password:       ****'");
  L('    } else {');
  L("      $lines += '  Dashboard:      Disabled'");
  L('    }');
  L('');
  // Use [Environment]::NewLine instead of backtick escapes
  L('    $reviewText.Text = $lines -join [Environment]::NewLine');
  L('  }');
  L('}');
  L('');
  L('# Validation per step');
  L('function Validate-Step {');
  L('  param($step)');
  L('');
  L('  switch ($step) {');
  L('    1 {');
  L('      if ($tokenInput.Text.Trim().Length -lt 20) {');
  L('        $tokenStatus.Text = "Token is too short. Please enter a valid Discord bot token."');
  L('        $tokenStatus.ForeColor = $ErrorColor');
  L('        return $false');
  L('      }');
  L('      $tokenStatus.Text = "Token accepted."');
  L('      $tokenStatus.ForeColor = $GreenColor');
  L('      return $true');
  L('    }');
  L('    4 {');
  L('      if ($chkDashboard.Checked) {');
  L('        $port = $portInput.Text.Trim()');
  // Use single-quoted string for regex so PS doesn't interpret \d
  L("        if (-not $port -or -not ($port -match '^\\d+$') -or [int]$port -lt 1 -or [int]$port -gt 65535) {");
  L('          $dashErrLabel.Text = "Please enter a valid port (1-65535)."');
  L('          return $false');
  L('        }');
  L('        if ($pwdInput.Text.Trim().Length -lt 4) {');
  L('          $dashErrLabel.Text = "Password must be at least 4 characters."');
  L('          return $false');
  L('        }');
  L('        $dashErrLabel.Text = ""');
  L('      }');
  L('      return $true');
  L('    }');
  L('    default { return $true }');
  L('  }');
  L('}');
  L('');
  L('# Button handlers');
  L('$btnNext.Add_Click({');
  L('  if (-not (Validate-Step $script:currentStep)) { return }');
  L('');
  L('  if ($script:currentStep -eq ($panels.Count - 1)) {');
  L('    $langIdx = $langList.SelectedIndex');
  L('    $langCode = $localeCodes[$langIdx]');
  L('');
  L('    $script:result.token = $tokenInput.Text.Trim()');
  L('    $script:result.locale = $langCode');
  L('    $script:result.openrouterKey = $orKeyInput.Text.Trim()');
  L('    $script:result.geminiKey = $gemKeyInput.Text.Trim()');
  L('    $script:result.aiChat = $chkAiChat.Checked');
  L('    $script:result.aiMod = $chkAiMod.Checked');
  L('');
  L('    if ($chkDashboard.Checked) {');
  L('      $script:result.webPort = $portInput.Text.Trim()');
  L('      $script:result.webPassword = $pwdInput.Text.Trim()');
  L('    } else {');
  L('      $script:result.webPort = ""');
  L('      $script:result.webPassword = ""');
  L('    }');
  L('');
  L('    $script:result.cancelled = $false');
  L('    $form.Close()');
  L('  } else {');
  L('    $script:currentStep++');
  L('    Show-Step $script:currentStep');
  L('  }');
  L('})');
  L('');
  L('$btnBack.Add_Click({');
  L('  if ($script:currentStep -gt 0) {');
  L('    $script:currentStep--');
  L('    Show-Step $script:currentStep');
  L('  }');
  L('})');
  L('');
  L('$btnCancel.Add_Click({');
  L('  $script:result.cancelled = $true');
  L('  $form.Close()');
  L('})');
  L('');
  L('$form.Add_FormClosing({');
  L('  $json = $script:result | ConvertTo-Json -Compress');
  L('  [System.IO.File]::WriteAllText("' + psResultPath + '", $json)');
  L('})');
  L('');
  L('# Show first step');
  L('Show-Step 0');
  L('');
  L('[void]$form.ShowDialog()');

  return lines.join('\r\n');
}

// ── Check if PowerShell is available ─────────────────────────────────────────

function isPowerShellAvailable() {
  try {
    debugLog('Testing PowerShell with: powershell -Command "exit 0"');
    execSync('powershell -Command "exit 0"', { stdio: 'ignore', timeout: 5000 });
    debugLog('PowerShell test passed');
    return true;
  } catch (err) {
    debugLog('PowerShell test FAILED:', err.message);
    return false;
  }
}

// ── Run the GUI wizard ───────────────────────────────────────────────────────

async function runGUI() {
  debugLog('runGUI() called');
  debugLog('basePath:', basePath);
  debugLog('tmpResultPath:', tmpResultPath);
  console.log('  Launching setup wizard...');

  // Write PowerShell script to temp file
  const psScriptPath = path.join(basePath, '_setup_wizard.ps1');
  debugLog('Writing PS script to:', psScriptPath);
  // Guide images path — _setup_guide next to exe, or assets/setup-guide in dev
  const guidePath = path.join(basePath, process.pkg ? '_setup_guide' : 'assets/setup-guide');
  debugLog('Guide images path:', guidePath);

  const psScript = generatePowerShellScript(tmpResultPath, guidePath);
  debugLog('PS script length:', psScript.length, 'chars');
  fs.writeFileSync(psScriptPath, psScript, 'utf-8');
  debugLog('PS script written OK');

  const psCmd = `powershell -ExecutionPolicy Bypass -File "${psScriptPath}" 2>&1`;
  debugLog('Running:', psCmd);

  try {
    // Run PowerShell script — capture output so we can log errors
    const psOutput = execSync(
      psCmd,
      { encoding: 'utf-8', timeout: 300000 }
    );
    debugLog('PowerShell script exited OK');
    if (psOutput && psOutput.trim()) {
      debugLog('PowerShell stdout:', psOutput.substring(0, 2000));
    }

    // Read result
    debugLog('Checking for result file:', tmpResultPath);
    if (!fs.existsSync(tmpResultPath)) {
      debugLog('Result file NOT found');
      console.log('  Setup wizard was closed. No configuration saved.');
      return false;
    }

    const resultJson = fs.readFileSync(tmpResultPath, 'utf-8');
    debugLog('Result JSON:', resultJson.substring(0, 200));
    const result = JSON.parse(resultJson);

    if (result.cancelled) {
      console.log('  Setup cancelled by user.');
      return false;
    }

    // Validate token against Discord API
    console.log('  Validating Discord bot token...');
    const tokenResult = await validateToken(result.token);

    let botClientId = '';
    if (tokenResult.valid) {
      botClientId = tokenResult.id;
      console.log(`  ✅ Connected as ${tokenResult.username} (ID: ${tokenResult.id})`);
    } else {
      console.log('  ⚠️  Could not validate token. Saving anyway...');
      // Try to extract client ID from token
      try {
        const parts = result.token.split('.');
        if (parts.length >= 1) {
          const decoded = Buffer.from(parts[0], 'base64').toString('utf-8');
          if (/^\d{17,20}$/.test(decoded)) {
            botClientId = decoded;
          }
        }
      } catch { /* ignore */ }
    }

    // Build .env content
    writeEnvFile(result, botClientId);

    // Copy example configs
    copyExampleConfigs();

    console.log('  ✅ Configuration saved!');
    console.log('');

    if (botClientId) {
      console.log(`  🔗 Invite your bot:`);
      console.log(`  https://discord.com/oauth2/authorize?client_id=${botClientId}&scope=bot+applications.commands&permissions=8`);
      console.log('');
    }

    return true;
  } catch (psErr) {
    debugLog('PowerShell CRASHED with error:', psErr.message);
    // execSync attaches stdout/stderr to the error object
    if (psErr.stdout) debugLog('PS stdout:', String(psErr.stdout).substring(0, 3000));
    if (psErr.stderr) debugLog('PS stderr:', String(psErr.stderr).substring(0, 3000));
    if (psErr.output) {
      const combined = psErr.output.filter(Boolean).map(b => String(b)).join('\n');
      debugLog('PS combined output:', combined.substring(0, 3000));
    }
    if (psErr.status !== undefined) debugLog('PS exit code:', psErr.status);
    throw psErr; // re-throw so exe-entry.js catches it too
  } finally {
    // Clean up temp files (keep .ps1 on failure for manual debugging)
    if (fs.existsSync(tmpResultPath)) {
      try { fs.unlinkSync(psScriptPath); } catch { /* ignore */ }
    } else {
      debugLog('Keeping _setup_wizard.ps1 for debugging (wizard failed)');
    }
    try { fs.unlinkSync(tmpResultPath); } catch { /* ignore */ }
  }
}

// ── Write .env file ──────────────────────────────────────────────────────────

function writeEnvFile(result, clientId) {
  const hasOpenRouter = result.openrouterKey && result.openrouterKey.length > 5;
  const hasGemini = result.geminiKey && result.geminiKey.length > 5;

  let envContent = `# AiAdminBot Configuration
# Generated by Setup Wizard (GUI) v1.0

# Discord Bot Credentials
DISCORD_TOKEN=${result.token}
${clientId ? `CLIENT_ID=${clientId}` : '# CLIENT_ID=your_bot_client_id'}

# Database
DATABASE_PATH=./data/bot.db

# Language: tr, en, de, es, fr, pt, ru, ar
LOCALE=${result.locale}

# Logging
LOG_LEVEL=info
`;

  // AI provider config
  if (hasGemini && hasOpenRouter) {
    envContent += `
# AI Provider — Dual provider with failover
AI_PROVIDER=gemini
GEMINI_API_KEY=${result.geminiKey}
OPENROUTER_API_KEY=${result.openrouterKey}
AI_MODEL=gemini-2.0-flash
`;
  } else if (hasGemini) {
    envContent += `
# AI Provider — Google Gemini
AI_PROVIDER=gemini
GEMINI_API_KEY=${result.geminiKey}
AI_MODEL=gemini-2.0-flash
`;
  } else {
    envContent += `
# AI Provider — OpenRouter (Free Models)
OPENROUTER_API_KEY=${hasOpenRouter ? result.openrouterKey : 'your_openrouter_key_here'}
AI_MODEL=openrouter/free
`;
  }

  envContent += `
# AI Features
AI_CHAT_ENABLED=${result.aiChat}
AI_CHAT_CHANNEL=ai-chat
AI_CHAT_RATE_LIMIT=5
AI_MODERATION_ENABLED=${result.aiMod}
AI_MOD_CONFIDENCE_THRESHOLD=0.8
AI_TIMEOUT_MINUTES=3

# Web Dashboard
${result.webPort ? `WEB_PORT=${result.webPort}` : '# WEB_PORT=3000'}
${result.webPassword ? `WEB_PASSWORD=${result.webPassword}` : '# WEB_PASSWORD=your_password_here'}
`;

  fs.writeFileSync(envPath, envContent);
}

// ── Copy example config files ────────────────────────────────────────────────

function copyExampleConfigs() {
  const configDir = path.join(basePath, 'config');
  const configFiles = [
    { example: 'config.example.json', target: 'config.json' },
    { example: 'server-setup.example.json', target: 'server-setup.json' },
    { example: 'role-menus.example.json', target: 'role-menus.json' },
  ];

  for (const { example, target } of configFiles) {
    const exampleFile = path.join(configDir, example);
    const targetFile = path.join(configDir, target);

    if (!fs.existsSync(targetFile) && fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, targetFile);
      console.log(`  ✅ Created config/${target}`);
    }
  }

  // Create data directory
  const dataDir = path.join(basePath, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// ── Exports & direct execution ───────────────────────────────────────────────

module.exports = { runGUI, isPowerShellAvailable };

// If run directly
if (require.main === module) {
  if (isPowerShellAvailable()) {
    runGUI().then(success => {
      process.exit(success ? 0 : 1);
    }).catch(err => {
      console.error('  Setup failed:', err.message);
      process.exit(1);
    });
  } else {
    console.log('  PowerShell not available. Falling back to CLI wizard...');
    require('./setup-wizard');
  }
}
