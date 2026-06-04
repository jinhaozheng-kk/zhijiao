param(
  [string]$Path = ".env.production"
)

$ErrorActionPreference = "Stop"

function Add-Problem {
  param(
    [System.Collections.Generic.List[string]]$Problems,
    [string]$Name,
    [string]$Message
  )
  $Problems.Add(("{0}: {1}" -f $Name, $Message)) | Out-Null
}

function Parse-EnvFile {
  param([string]$EnvPath)

  if (-not (Test-Path -LiteralPath $EnvPath)) {
    throw "Env file not found: $EnvPath"
  }

  $values = [ordered]@{}
  $lineNo = 0
  foreach ($rawLine in Get-Content -LiteralPath $EnvPath) {
    $lineNo += 1
    $line = $rawLine.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      continue
    }

    if ($line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$") {
      throw "Invalid env line ${lineNo}: expected KEY=value"
    }

    $key = $Matches[1]
    $value = $Matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }

  return $values
}

function Has-Value {
  param(
    [hashtable]$Env,
    [string]$Name
  )
  return $Env.Contains($Name) -and -not [string]::IsNullOrWhiteSpace([string]$Env[$Name])
}

function Require-Keys {
  param(
    [hashtable]$Env,
    [System.Collections.Generic.List[string]]$Problems,
    [string[]]$Names,
    [string]$Reason = "required"
  )

  foreach ($name in $Names) {
    if (-not (Has-Value $Env $name)) {
      Add-Problem $Problems $name $Reason
    }
  }
}

function Require-BoolString {
  param(
    [hashtable]$Env,
    [System.Collections.Generic.List[string]]$Problems,
    [string]$Name
  )

  if (-not (Has-Value $Env $Name)) {
    Add-Problem $Problems $Name "required"
    return
  }

  $value = [string]$Env[$Name]
  if ($value -ne "true" -and $value -ne "false") {
    Add-Problem $Problems $Name "must be 'true' or 'false'"
  }
}

function Require-MinLength {
  param(
    [hashtable]$Env,
    [System.Collections.Generic.List[string]]$Problems,
    [string]$Name,
    [int]$MinLength
  )

  if (-not (Has-Value $Env $Name)) {
    Add-Problem $Problems $Name "required"
    return
  }

  if (([string]$Env[$Name]).Length -lt $MinLength) {
    Add-Problem $Problems $Name "must be at least $MinLength bytes/chars"
  }
}

function Check-Forbidden-Values {
  param(
    [hashtable]$Env,
    [System.Collections.Generic.List[string]]$Problems
  )

  $pattern = "(?i)(replace-with|placeholder|test-only|e2e|dev-only)"
  foreach ($key in $Env.Keys) {
    $value = [string]$Env[$key]
    if ($value -match $pattern) {
      Add-Problem $Problems $key "contains placeholder/dev/test-looking value"
    }
  }
}

try {
  $envMap = Parse-EnvFile $Path
} catch {
  Write-Error $_
  exit 2
}

$problems = [System.Collections.Generic.List[string]]::new()

Require-Keys $envMap $problems @(
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "NEXT_PUBLIC_APP_URL",
  "CREDIT_PER_YUAN",
  "MINOR_MONTHLY_LIMIT_YUAN",
  "DEMO_MODE"
)

Require-MinLength $envMap $problems "POSTGRES_PASSWORD" 16
Require-MinLength $envMap $problems "ACCESS_JWT_SECRET" 32
Require-MinLength $envMap $problems "OTP_PEPPER" 16

foreach ($name in @("AI_USE_MOCK", "SMS_USE_MOCK", "WECHAT_OAUTH_USE_MOCK", "WECHAT_PAY_USE_MOCK", "STORAGE_USE_MOCK")) {
  Require-BoolString $envMap $problems $name
}

if ((Has-Value $envMap "NEXT_PUBLIC_APP_URL") -and ([string]$envMap["NEXT_PUBLIC_APP_URL"] -notmatch "^https?://")) {
  Add-Problem $problems "NEXT_PUBLIC_APP_URL" "must be an absolute http(s) URL"
}

if ((Has-Value $envMap "DEMO_MODE") -and ([string]$envMap["DEMO_MODE"] -ne "0")) {
  Add-Problem $problems "DEMO_MODE" "must be 0 for production launch"
}

if ($envMap.Contains("E2E_TEST_HOOKS") -and [string]$envMap["E2E_TEST_HOOKS"] -ne "0") {
  Add-Problem $problems "E2E_TEST_HOOKS" "must be 0 if explicitly set"
}

Check-Forbidden-Values $envMap $problems

if ((Has-Value $envMap "AI_USE_MOCK") -and [string]$envMap["AI_USE_MOCK"] -eq "false") {
  Require-Keys $envMap $problems @("DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL") "required when AI_USE_MOCK=false"
}

if ((Has-Value $envMap "SMS_USE_MOCK") -and [string]$envMap["SMS_USE_MOCK"] -eq "false") {
  Require-Keys $envMap $problems @(
    "ALIYUN_SMS_ACCESS_KEY_ID",
    "ALIYUN_SMS_ACCESS_KEY_SECRET",
    "ALIYUN_SMS_SIGN_NAME",
    "ALIYUN_SMS_TEMPLATE_CODE"
  ) "required when SMS_USE_MOCK=false"
}

if ((Has-Value $envMap "WECHAT_OAUTH_USE_MOCK") -and [string]$envMap["WECHAT_OAUTH_USE_MOCK"] -eq "false") {
  Require-Keys $envMap $problems @("WECHAT_H5_APPID", "WECHAT_H5_SECRET") "required when WECHAT_OAUTH_USE_MOCK=false"
}

if ((Has-Value $envMap "WECHAT_PAY_USE_MOCK") -and [string]$envMap["WECHAT_PAY_USE_MOCK"] -eq "true") {
  Require-MinLength $envMap $problems "MOCK_WECHAT_PAY_SECRET" 16
  Require-Keys $envMap $problems @("WECHAT_PAY_APPID", "WECHAT_PAY_MCHID") "required when WECHAT_PAY_USE_MOCK=true"
}

if ((Has-Value $envMap "WECHAT_PAY_USE_MOCK") -and [string]$envMap["WECHAT_PAY_USE_MOCK"] -eq "false") {
  Require-Keys $envMap $problems @(
    "WECHAT_PAY_APPID",
    "WECHAT_PAY_MCHID",
    "WECHAT_PAY_API_V3_KEY",
    "WECHAT_PAY_PRIVATE_KEY",
    "WECHAT_PAY_CERT_SERIAL",
    "WECHAT_PAY_PUB_KEY_FILE",
    "WECHAT_PAY_NOTIFY_HOST"
  ) "required when WECHAT_PAY_USE_MOCK=false"
}

if ((Has-Value $envMap "STORAGE_USE_MOCK") -and [string]$envMap["STORAGE_USE_MOCK"] -eq "false") {
  Require-Keys $envMap $problems @(
    "ALIYUN_OSS_ACCESS_KEY_ID",
    "ALIYUN_OSS_ACCESS_KEY_SECRET",
    "ALIYUN_OSS_BUCKET",
    "ALIYUN_OSS_REGION",
    "ALIYUN_OSS_ENDPOINT"
  ) "required when STORAGE_USE_MOCK=false"
}

if ($problems.Count -gt 0) {
  Write-Host "[production-env] FAILED: $($problems.Count) problem(s)" -ForegroundColor Red
  foreach ($problem in $problems) {
    Write-Host " - $problem" -ForegroundColor Red
  }
  exit 1
}

Write-Host "[production-env] OK: $Path passed production env checks" -ForegroundColor Green
