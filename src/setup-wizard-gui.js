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

function generatePowerShellScript(resultPath) {
  // Escape backslashes for PowerShell string
  const psResultPath = resultPath.replace(/\\/g, '\\\\');
  // Use backtick variable to avoid JS template literal issues
  const BT = '`';

  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

# ── Color Palette ──────────────────────────────────────────────────
$BgColor       = [System.Drawing.Color]::FromArgb(30, 30, 46)
$PanelBg       = [System.Drawing.Color]::FromArgb(40, 40, 60)
$AccentColor   = [System.Drawing.Color]::FromArgb(88, 101, 242)  # Discord blurple
$TextColor     = [System.Drawing.Color]::White
$DimColor      = [System.Drawing.Color]::FromArgb(160, 160, 180)
$InputBg       = [System.Drawing.Color]::FromArgb(50, 50, 70)
$GreenColor    = [System.Drawing.Color]::FromArgb(87, 242, 135)
$ErrorColor    = [System.Drawing.Color]::FromArgb(237, 66, 69)

# ── Fonts ──────────────────────────────────────────────────────────
$TitleFont   = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$HeadFont    = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$BodyFont    = New-Object System.Drawing.Font("Segoe UI", 10)
$SmallFont   = New-Object System.Drawing.Font("Segoe UI", 9)
$InputFont   = New-Object System.Drawing.Font("Consolas", 11)
$BtnFont     = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)

# ── Main Form ──────────────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = "AiAdminBot — Setup Wizard"
$form.Size = New-Object System.Drawing.Size(620, 520)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = $BgColor
$form.ForeColor = $TextColor
$form.Font = $BodyFont

# ── Result holder ──────────────────────────────────────────────────
$script:result = @{
  token = ""
  locale = "tr"
  aiProvider = "skip"
  openrouterKey = ""
  geminiKey = ""
  aiChat = $false
  aiMod = $false
  webPort = ""
  webPassword = ""
  cancelled = $true
}

$script:currentStep = 0
$totalSteps = 5

# ── Panels (one per step) ─────────────────────────────────────────
$panels = @()

# ── Helper: create a styled label ─────────────────────────────────
function New-StyledLabel {
  param($text, $x, $y, $width, $height, $font, $color)
  $lbl = New-Object System.Windows.Forms.Label
  $lbl.Text = $text
  $lbl.Location = New-Object System.Drawing.Point($x, $y)
  $lbl.Size = New-Object System.Drawing.Size($width, $height)
  $lbl.Font = if ($font) { $font } else { $BodyFont }
  $lbl.ForeColor = if ($color) { $color } else { $TextColor }
  $lbl.BackColor = [System.Drawing.Color]::Transparent
  return $lbl
}

# ── Helper: create a styled textbox ───────────────────────────────
function New-StyledInput {
  param($x, $y, $width, $isPassword)
  $txt = New-Object System.Windows.Forms.TextBox
  $txt.Location = New-Object System.Drawing.Point($x, $y)
  $txt.Size = New-Object System.Drawing.Size($width, 30)
  $txt.Font = $InputFont
  $txt.BackColor = $InputBg
  $txt.ForeColor = $TextColor
  $txt.BorderStyle = "FixedSingle"
  if ($isPassword) { $txt.UseSystemPasswordChar = $true }
  return $txt
}

# ── Helper: create a styled button ────────────────────────────────
function New-StyledButton {
  param($text, $x, $y, $width, $primary)
  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = $text
  $btn.Location = New-Object System.Drawing.Point($x, $y)
  $btn.Size = New-Object System.Drawing.Size($width, 38)
  $btn.Font = $BtnFont
  $btn.FlatStyle = "Flat"
  $btn.FlatAppearance.BorderSize = 0
  $btn.Cursor = "Hand"
  if ($primary) {
    $btn.BackColor = $AccentColor
    $btn.ForeColor = $TextColor
  } else {
    $btn.BackColor = $PanelBg
    $btn.ForeColor = $DimColor
  }
  return $btn
}

# ── Progress bar (top) ─────────────────────────────────────────────
$progressPanel = New-Object System.Windows.Forms.Panel
$progressPanel.Location = New-Object System.Drawing.Point(0, 0)
$progressPanel.Size = New-Object System.Drawing.Size(620, 60)
$progressPanel.BackColor = $PanelBg

$stepLabel = New-Object System.Windows.Forms.Label
$stepLabel.Location = New-Object System.Drawing.Point(20, 15)
$stepLabel.Size = New-Object System.Drawing.Size(560, 30)
$stepLabel.Font = $HeadFont
$stepLabel.ForeColor = $TextColor
$stepLabel.BackColor = [System.Drawing.Color]::Transparent

$progressBar = New-Object System.Windows.Forms.Panel
$progressBar.Location = New-Object System.Drawing.Point(0, 54)
$progressBar.Size = New-Object System.Drawing.Size(0, 6)
$progressBar.BackColor = $AccentColor

$progressPanel.Controls.Add($stepLabel)
$progressPanel.Controls.Add($progressBar)
$form.Controls.Add($progressPanel)

# ── Navigation buttons (bottom) ────────────────────────────────────
$btnBack = New-StyledButton "← Back" 20 435 110 $false
$btnNext = New-StyledButton "Next →" 475 435 110 $true
$btnCancel = New-StyledButton "Cancel" 250 435 110 $false

$form.Controls.Add($btnBack)
$form.Controls.Add($btnNext)
$form.Controls.Add($btnCancel)

# ══════════════════════════════════════════════════════════════════
# STEP 0: Welcome
# ══════════════════════════════════════════════════════════════════
$p0 = New-Object System.Windows.Forms.Panel
$p0.Location = New-Object System.Drawing.Point(0, 60)
$p0.Size = New-Object System.Drawing.Size(620, 370)
$p0.BackColor = $BgColor

$p0.Controls.Add((New-StyledLabel "Welcome to AiAdminBot Setup" 30 30 540 40 $TitleFont $TextColor))
$p0.Controls.Add((New-StyledLabel "This wizard will help you configure your Discord admin bot." 30 80 540 25 $BodyFont $DimColor))
$p0.Controls.Add((New-StyledLabel "You will need:" 30 120 540 25 $BodyFont $TextColor))
$p0.Controls.Add((New-StyledLabel "• A Discord Bot Token (from Discord Developer Portal)" 50 150 520 25 $BodyFont $DimColor))
$p0.Controls.Add((New-StyledLabel "• (Optional) An API key for AI features" 50 175 520 25 $BodyFont $DimColor))
$p0.Controls.Add((New-StyledLabel "• (Optional) A password for the web dashboard" 50 200 520 25 $BodyFont $DimColor))
$p0.Controls.Add((New-StyledLabel "Click 'Next' to begin." 30 260 540 25 $BodyFont $GreenColor))

$panels += $p0

# ══════════════════════════════════════════════════════════════════
# STEP 1: Discord Bot Token
# ══════════════════════════════════════════════════════════════════
$p1 = New-Object System.Windows.Forms.Panel
$p1.Location = New-Object System.Drawing.Point(0, 60)
$p1.Size = New-Object System.Drawing.Size(620, 370)
$p1.BackColor = $BgColor

$p1.Controls.Add((New-StyledLabel "Discord Bot Token" 30 15 540 30 $HeadFont $TextColor))
$p1.Controls.Add((New-StyledLabel "Create a bot at discord.com/developers/applications" 30 50 540 20 $SmallFont $DimColor))
$p1.Controls.Add((New-StyledLabel "Go to Bot tab → Reset Token → Copy and paste below:" 30 70 540 20 $SmallFont $DimColor))

$tokenInput = New-StyledInput 30 110 545 $true
$p1.Controls.Add($tokenInput)

$tokenStatus = New-StyledLabel "" 30 150 545 20 $SmallFont $DimColor
$p1.Controls.Add($tokenStatus)

$chkShowToken = New-Object System.Windows.Forms.CheckBox
$chkShowToken.Text = "Show token"
$chkShowToken.Location = New-Object System.Drawing.Point(30, 180)
$chkShowToken.Size = New-Object System.Drawing.Size(200, 25)
$chkShowToken.Font = $SmallFont
$chkShowToken.ForeColor = $DimColor
$chkShowToken.BackColor = [System.Drawing.Color]::Transparent
$chkShowToken.Add_CheckedChanged({
  $tokenInput.UseSystemPasswordChar = -not $chkShowToken.Checked
})
$p1.Controls.Add($chkShowToken)

$panels += $p1

# ══════════════════════════════════════════════════════════════════
# STEP 2: Language
# ══════════════════════════════════════════════════════════════════
$p2 = New-Object System.Windows.Forms.Panel
$p2.Location = New-Object System.Drawing.Point(0, 60)
$p2.Size = New-Object System.Drawing.Size(620, 370)
$p2.BackColor = $BgColor

$p2.Controls.Add((New-StyledLabel "Select Language" 30 15 540 30 $HeadFont $TextColor))
$p2.Controls.Add((New-StyledLabel "Choose the language for bot messages and channel names:" 30 50 540 20 $SmallFont $DimColor))

$langList = New-Object System.Windows.Forms.ListBox
$langList.Location = New-Object System.Drawing.Point(30, 85)
$langList.Size = New-Object System.Drawing.Size(545, 200)
$langList.Font = New-Object System.Drawing.Font("Segoe UI", 12)
$langList.BackColor = $InputBg
$langList.ForeColor = $TextColor
$langList.BorderStyle = "FixedSingle"
$langList.Items.AddRange(@(
  "tr  —  Türkçe",
  "en  —  English",
  "de  —  Deutsch",
  "es  —  Español",
  "fr  —  Français",
  "pt  —  Português",
  "ru  —  Русский",
  "ar  —  العربية"
))
$langList.SelectedIndex = 0
$p2.Controls.Add($langList)

$langPreview = New-StyledLabel "" 30 295 545 40 $SmallFont $DimColor
$p2.Controls.Add($langPreview)

$langPreviews = @{
  0 = "Channels: #doğrulama  #hoş-geldin  #kurallar  #genel-sohbet  #ai-sohbet"
  1 = "Channels: #verification  #welcome  #rules  #general-chat  #ai-chat"
  2 = "Channels: #verifizierung  #willkommen  #regeln  #allgemein-chat  #ki-chat"
  3 = "Channels: #verificación  #bienvenida  #reglas  #chat-general  #ia-chat"
  4 = "Channels: #vérification  #bienvenue  #règles  #discussion-générale  #ia-chat"
  5 = "Channels: #verificação  #boas-vindas  #regras  #bate-papo-geral  #ia-chat"
  6 = "Channels: #верификация  #добро-пожаловать  #правила  #общий-чат  #ии-чат"
  7 = "Channels: #التحقق  #مرحبا  #القواعد  #الدردشة-العامة  #دردشة-ذكاء"
}

$langList.Add_SelectedIndexChanged({
  $langPreview.Text = $langPreviews[$langList.SelectedIndex]
})
$langPreview.Text = $langPreviews[0]

$panels += $p2

# ══════════════════════════════════════════════════════════════════
# STEP 3: AI Features
# ══════════════════════════════════════════════════════════════════
$p3 = New-Object System.Windows.Forms.Panel
$p3.Location = New-Object System.Drawing.Point(0, 60)
$p3.Size = New-Object System.Drawing.Size(620, 370)
$p3.BackColor = $BgColor

$p3.Controls.Add((New-StyledLabel "AI Features (Optional)" 30 15 540 30 $HeadFont $TextColor))
$p3.Controls.Add((New-StyledLabel "Add AI-powered chat and smart moderation to your bot." 30 50 540 20 $SmallFont $DimColor))

$p3.Controls.Add((New-StyledLabel "OpenRouter API Key:" 30 85 250 20 $BodyFont $TextColor))
$p3.Controls.Add((New-StyledLabel "openrouter.ai/keys — free tier available" 280 85 290 20 $SmallFont $DimColor))
$orKeyInput = New-StyledInput 30 110 545 $false
$p3.Controls.Add($orKeyInput)

$p3.Controls.Add((New-StyledLabel "Google Gemini API Key:" 30 155 250 20 $BodyFont $TextColor))
$p3.Controls.Add((New-StyledLabel "aistudio.google.com/apikey — free tier" 280 155 290 20 $SmallFont $DimColor))
$gemKeyInput = New-StyledInput 30 180 545 $false
$p3.Controls.Add($gemKeyInput)

$chkAiChat = New-Object System.Windows.Forms.CheckBox
$chkAiChat.Text = "Enable AI Chat Assistant"
$chkAiChat.Location = New-Object System.Drawing.Point(30, 230)
$chkAiChat.Size = New-Object System.Drawing.Size(250, 25)
$chkAiChat.Font = $BodyFont
$chkAiChat.ForeColor = $TextColor
$chkAiChat.BackColor = [System.Drawing.Color]::Transparent
$chkAiChat.Checked = $true
$p3.Controls.Add($chkAiChat)

$chkAiMod = New-Object System.Windows.Forms.CheckBox
$chkAiMod.Text = "Enable AI Smart Moderation"
$chkAiMod.Location = New-Object System.Drawing.Point(30, 260)
$chkAiMod.Size = New-Object System.Drawing.Size(250, 25)
$chkAiMod.Font = $BodyFont
$chkAiMod.ForeColor = $TextColor
$chkAiMod.BackColor = [System.Drawing.Color]::Transparent
$chkAiMod.Checked = $true
$p3.Controls.Add($chkAiMod)

$p3.Controls.Add((New-StyledLabel "Leave both keys blank to skip AI features." 30 310 540 20 $SmallFont $DimColor))

$panels += $p3

# ══════════════════════════════════════════════════════════════════
# STEP 4: Web Dashboard
# ══════════════════════════════════════════════════════════════════
$p4 = New-Object System.Windows.Forms.Panel
$p4.Location = New-Object System.Drawing.Point(0, 60)
$p4.Size = New-Object System.Drawing.Size(620, 370)
$p4.BackColor = $BgColor

$p4.Controls.Add((New-StyledLabel "Web Dashboard" 30 15 540 30 $HeadFont $TextColor))
$p4.Controls.Add((New-StyledLabel "Access moderation logs, roles, and settings from your browser." 30 50 540 20 $SmallFont $DimColor))

$chkDashboard = New-Object System.Windows.Forms.CheckBox
$chkDashboard.Text = "Enable Web Dashboard"
$chkDashboard.Location = New-Object System.Drawing.Point(30, 85)
$chkDashboard.Size = New-Object System.Drawing.Size(250, 25)
$chkDashboard.Font = $BodyFont
$chkDashboard.ForeColor = $TextColor
$chkDashboard.BackColor = [System.Drawing.Color]::Transparent
$chkDashboard.Checked = $true
$p4.Controls.Add($chkDashboard)

$lblPort = New-StyledLabel "Port:" 30 125 50 25 $BodyFont $TextColor
$p4.Controls.Add($lblPort)

$portInput = New-StyledInput 80 122 100 $false
$portInput.Text = "3000"
$p4.Controls.Add($portInput)

$lblPwd = New-StyledLabel "Dashboard Password:" 30 170 200 25 $BodyFont $TextColor
$p4.Controls.Add($lblPwd)

$pwdInput = New-StyledInput 30 198 545 $true
$p4.Controls.Add($pwdInput)

$lblPwdHint = New-StyledLabel "Minimum 4 characters. You will use this to log into the dashboard." 30 235 545 20 $SmallFont $DimColor
$p4.Controls.Add($lblPwdHint)

$chkShowPwd = New-Object System.Windows.Forms.CheckBox
$chkShowPwd.Text = "Show password"
$chkShowPwd.Location = New-Object System.Drawing.Point(30, 260)
$chkShowPwd.Size = New-Object System.Drawing.Size(200, 25)
$chkShowPwd.Font = $SmallFont
$chkShowPwd.ForeColor = $DimColor
$chkShowPwd.BackColor = [System.Drawing.Color]::Transparent
$chkShowPwd.Add_CheckedChanged({
  $pwdInput.UseSystemPasswordChar = -not $chkShowPwd.Checked
})
$p4.Controls.Add($chkShowPwd)

$dashErrLabel = New-StyledLabel "" 30 290 545 20 $SmallFont $ErrorColor
$p4.Controls.Add($dashErrLabel)

# Toggle dashboard fields
$chkDashboard.Add_CheckedChanged({
  $enabled = $chkDashboard.Checked
  $portInput.Enabled = $enabled
  $pwdInput.Enabled = $enabled
  $chkShowPwd.Enabled = $enabled
})

$panels += $p4

# ══════════════════════════════════════════════════════════════════
# STEP 5 (index 4): Review & Finish
# ══════════════════════════════════════════════════════════════════
$p5 = New-Object System.Windows.Forms.Panel
$p5.Location = New-Object System.Drawing.Point(0, 60)
$p5.Size = New-Object System.Drawing.Size(620, 370)
$p5.BackColor = $BgColor

$p5.Controls.Add((New-StyledLabel "Review Configuration" 30 15 540 30 $HeadFont $TextColor))

$reviewText = New-Object System.Windows.Forms.RichTextBox
$reviewText.Location = New-Object System.Drawing.Point(30, 55)
$reviewText.Size = New-Object System.Drawing.Size(545, 250)
$reviewText.Font = New-Object System.Drawing.Font("Consolas", 11)
$reviewText.BackColor = $InputBg
$reviewText.ForeColor = $GreenColor
$reviewText.BorderStyle = "None"
$reviewText.ReadOnly = $true
$p5.Controls.Add($reviewText)

$p5.Controls.Add((New-StyledLabel "Click 'Finish' to save and start the bot." 30 315 540 25 $BodyFont $GreenColor))

$panels += $p5

# ── Add all panels to form (hidden initially) ──────────────────────
foreach ($panel in $panels) {
  $panel.Visible = $false
  $form.Controls.Add($panel)
}

# ── Navigation logic ───────────────────────────────────────────────
$stepTitles = @(
  "Welcome",
  "Step 1 of 4 — Discord Bot Token",
  "Step 2 of 4 — Language",
  "Step 3 of 4 — AI Features",
  "Step 4 of 4 — Web Dashboard",
  "Review & Finish"
)

$localeCodes = @("tr","en","de","es","fr","pt","ru","ar")

function Show-Step {
  param($step)
  for ($i = 0; $i -lt $panels.Count; $i++) {
    $panels[$i].Visible = ($i -eq $step)
  }
  $stepLabel.Text = $stepTitles[$step]
  $progressBar.Size = New-Object System.Drawing.Size(([int](620 * $step / ($panels.Count - 1))), 6)

  $btnBack.Visible = ($step -gt 0)
  if ($step -eq ($panels.Count - 1)) {
    $btnNext.Text = "Finish ✓"
  } else {
    $btnNext.Text = "Next →"
  }

  # Populate review on last step
  if ($step -eq ($panels.Count - 1)) {
    $langIdx = $langList.SelectedIndex
    $langCode = $localeCodes[$langIdx]
    $langName = $langList.SelectedItem

    $lines = @()
    $lines += "  Bot Token:      ****" + $tokenInput.Text.Substring([Math]::Max(0, $tokenInput.Text.Length - 6))
    $lines += "  Language:       $langName"
    $lines += ""

    if ($orKeyInput.Text.Trim() -or $gemKeyInput.Text.Trim()) {
      if ($orKeyInput.Text.Trim()) { $lines += "  OpenRouter:     Configured" }
      if ($gemKeyInput.Text.Trim()) { $lines += "  Gemini:         Configured" }
      $lines += "  AI Chat:        $(if ($chkAiChat.Checked) {'Enabled'} else {'Disabled'})"
      $lines += "  AI Moderation:  $(if ($chkAiMod.Checked) {'Enabled'} else {'Disabled'})"
    } else {
      $lines += "  AI Features:    Skipped"
    }

    $lines += ""
    if ($chkDashboard.Checked) {
      $lines += "  Dashboard:      Port $($portInput.Text)"
      $lines += "  Password:       ****"
    } else {
      $lines += "  Dashboard:      Disabled"
    }

    $reviewText.Text = $lines -join "${BT}r${BT}n"
  }
}

# ── Validation per step ────────────────────────────────────────────
function Validate-Step {
  param($step)

  switch ($step) {
    1 {
      # Token
      if ($tokenInput.Text.Trim().Length -lt 20) {
        $tokenStatus.Text = "Token is too short. Please enter a valid Discord bot token."
        $tokenStatus.ForeColor = $ErrorColor
        return $false
      }
      $tokenStatus.Text = "Token accepted."
      $tokenStatus.ForeColor = $GreenColor
      return $true
    }
    4 {
      # Dashboard
      if ($chkDashboard.Checked) {
        $port = $portInput.Text.Trim()
        if (-not $port -or -not ($port -match '^\\d+$') -or [int]$port -lt 1 -or [int]$port -gt 65535) {
          $dashErrLabel.Text = "Please enter a valid port (1-65535)."
          return $false
        }
        if ($pwdInput.Text.Trim().Length -lt 4) {
          $dashErrLabel.Text = "Password must be at least 4 characters."
          return $false
        }
        $dashErrLabel.Text = ""
      }
      return $true
    }
    default { return $true }
  }
}

# ── Button handlers ────────────────────────────────────────────────
$btnNext.Add_Click({
  if (-not (Validate-Step $script:currentStep)) { return }

  if ($script:currentStep -eq ($panels.Count - 1)) {
    # Finish — collect results
    $langIdx = $langList.SelectedIndex
    $langCode = $localeCodes[$langIdx]

    $script:result.token = $tokenInput.Text.Trim()
    $script:result.locale = $langCode
    $script:result.openrouterKey = $orKeyInput.Text.Trim()
    $script:result.geminiKey = $gemKeyInput.Text.Trim()
    $script:result.aiChat = $chkAiChat.Checked
    $script:result.aiMod = $chkAiMod.Checked

    if ($chkDashboard.Checked) {
      $script:result.webPort = $portInput.Text.Trim()
      $script:result.webPassword = $pwdInput.Text.Trim()
    } else {
      $script:result.webPort = ""
      $script:result.webPassword = ""
    }

    $script:result.cancelled = $false
    $form.Close()
  } else {
    $script:currentStep++
    Show-Step $script:currentStep
  }
})

$btnBack.Add_Click({
  if ($script:currentStep -gt 0) {
    $script:currentStep--
    Show-Step $script:currentStep
  }
})

$btnCancel.Add_Click({
  $script:result.cancelled = $true
  $form.Close()
})

$form.Add_FormClosing({
  # Write result to temp file
  $json = $script:result | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText("${psResultPath}", $json)
})

# ── Show first step ────────────────────────────────────────────────
Show-Step 0

[void]$form.ShowDialog()
`;
}

// ── Check if PowerShell is available ─────────────────────────────────────────

function isPowerShellAvailable() {
  try {
    execSync('powershell -Command "exit 0"', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── Run the GUI wizard ───────────────────────────────────────────────────────

async function runGUI() {
  console.log('  Launching setup wizard...');

  // Write PowerShell script to temp file
  const psScriptPath = path.join(basePath, '_setup_wizard.ps1');
  const psScript = generatePowerShellScript(tmpResultPath);
  fs.writeFileSync(psScriptPath, psScript, 'utf-8');

  try {
    // Run PowerShell script
    execSync(
      `powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`,
      { stdio: 'inherit', timeout: 300000 } // 5 minute timeout
    );

    // Read result
    if (!fs.existsSync(tmpResultPath)) {
      console.log('  Setup wizard was closed. No configuration saved.');
      return false;
    }

    const resultJson = fs.readFileSync(tmpResultPath, 'utf-8');
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
  } finally {
    // Clean up temp files
    try { fs.unlinkSync(psScriptPath); } catch { /* ignore */ }
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
