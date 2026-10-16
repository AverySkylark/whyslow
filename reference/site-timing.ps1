<#
.SYNOPSIS
  Shows how long a web page's HTML, JS, CSS (and images) take to load, plus DNS / TCP / TLS time per domain.

.USAGE
  powershell -ExecutionPolicy Bypass -File .\site-timing.ps1
  powershell -ExecutionPolicy Bypass -File .\site-timing.ps1 -Url https://example.com -Images -Csv results.csv
#>
param(
    [string]$Url,             # optional: if omitted, the script asks for it
    [switch]$Images,          # also time <img> files
    [string]$Csv,             # optional: export resource timings to CSV
    [string]$LogDir = "D:\crockfordFiles\OneDrive\ClaudeAI\logs",   # where the .md report is saved
    [int]$TimeoutSec = 30
)

if (-not $Url) {
    $Url = Read-Host "Enter the domain or URL to test (e.g. example.com)"
}
$Url = $Url.Trim()
if (-not $Url) { Write-Host "No domain entered." -ForegroundColor Red; exit 1 }
if ($Url -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') { $Url = "https://$Url" }

Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor 3072

$ErrorActionPreference = "Stop"
$base = [Uri]$Url

function Measure-Domain([string]$hostName, [int]$port = 443) {
    $r = [ordered]@{ Domain = $hostName; DnsMs = $null; TcpMs = $null; TlsMs = $null; IP = $null; Error = $null }
    try {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $ips = [Net.Dns]::GetHostAddresses($hostName)
        $sw.Stop()
        $r.DnsMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
        $ip = $ips | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1
        if (-not $ip) { $ip = $ips[0] }
        $r.IP = $ip.ToString()

        $client = New-Object Net.Sockets.TcpClient
        $sw.Restart()
        $client.ConnectAsync($ip, $port).Wait($TimeoutSec * 1000) | Out-Null
        $sw.Stop()
        $r.TcpMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)

        $ssl = New-Object Net.Security.SslStream($client.GetStream(), $false)
        $sw.Restart()
        $ssl.AuthenticateAsClient($hostName)
        $sw.Stop()
        $r.TlsMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
        $ssl.Dispose(); $client.Close()
    } catch { $r.Error = $_.Exception.Message }
    [pscustomobject]$r
}

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AutomaticDecompression = [Net.DecompressionMethods]::None   # so we can see if compression is used
$handler.AllowAutoRedirect = $true
$http = New-Object System.Net.Http.HttpClient($handler)
$http.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
$http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) site-timing/1.0")
$http.DefaultRequestHeaders.AcceptEncoding.ParseAdd("gzip, deflate, br")

function Get-Timed([string]$u, [string]$type) {
    $o = [ordered]@{ Type = $type; Url = $u; Domain = ([Uri]$u).Host; Status = $null; TtfbMs = $null; TotalMs = $null; KB = $null; Encoding = ""; Cache = ""; Error = $null }
    try {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $resp = $http.GetAsync($u, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
        $o.TtfbMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 0)
        $o.Status = [int]$resp.StatusCode
        $bytes = $resp.Content.ReadAsByteArrayAsync().Result
        $sw.Stop()
        $o.TotalMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 0)
        $o.KB = [math]::Round($bytes.Length / 1KB, 1)
        if ($resp.Content.Headers.ContentEncoding) { $o.Encoding = ($resp.Content.Headers.ContentEncoding -join ",") }
        if ($resp.Headers.CacheControl) { $o.Cache = $resp.Headers.CacheControl.ToString() }
        $o | Add-Member -NotePropertyName Body -NotePropertyValue $bytes -PassThru | Out-Null
    } catch { $o.Error = $_.Exception.InnerException.Message; if (-not $o.Error) { $o.Error = $_.Exception.Message } }
    [pscustomobject]$o
}

Write-Host "`n=== Timing $Url ===`n" -ForegroundColor Cyan

# 1. Main HTML document
$page = Get-Timed $Url "HTML"
if ($page.Error) { Write-Host "Failed to load page: $($page.Error)" -ForegroundColor Red; exit 1 }
# Re-fetch with automatic decompression just to parse the HTML
$h2 = New-Object System.Net.Http.HttpClientHandler
$h2.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
$parser = New-Object System.Net.Http.HttpClient($h2)
$parser.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
$html = $parser.GetStringAsync($Url).Result

Write-Host ("HTML: status {0}, TTFB {1} ms, total {2} ms, {3} KB, encoding '{4}'" -f $page.Status, $page.TtfbMs, $page.TotalMs, $page.KB, $page.Encoding) -ForegroundColor Yellow

# 2. Find resources
$found = New-Object System.Collections.Generic.List[object]
foreach ($m in [regex]::Matches($html, '<script[^>]+src\s*=\s*["'']([^"'']+)["'']', 'IgnoreCase')) { $found.Add(@{ T = "JS"; U = $m.Groups[1].Value }) }
foreach ($m in [regex]::Matches($html, '<link[^>]+>', 'IgnoreCase')) {
    if ($m.Value -match 'rel\s*=\s*["'']?[^"'']*stylesheet' -and $m.Value -match 'href\s*=\s*["'']([^"'']+)["'']') { $found.Add(@{ T = "CSS"; U = $Matches[1] }) }
}
if ($Images) {
    foreach ($m in [regex]::Matches($html, '<img[^>]+src\s*=\s*["'']([^"'']+)["'']', 'IgnoreCase')) { $found.Add(@{ T = "IMG"; U = $m.Groups[1].Value }) }
}

$resources = @()
$seen = @{}
foreach ($f in $found) {
    $raw = $f.U.Trim()
    if ($raw -match '^(data:|javascript:|#)') { continue }
    try { $abs = (New-Object Uri($base, $raw)).AbsoluteUri } catch { continue }
    if ($seen.ContainsKey($abs)) { continue }
    $seen[$abs] = $true
    $resources += [pscustomobject]@{ Type = $f.T; Url = $abs }
}
Write-Host ("Found {0} resources ({1} JS, {2} CSS{3})`n" -f $resources.Count, ($resources | ? Type -eq JS).Count, ($resources | ? Type -eq CSS).Count, $(if ($Images) { ", $(($resources | ? Type -eq IMG).Count) images" } else { "" }))

# 3. DNS / TCP / TLS per domain
$domains = $resources | ForEach-Object { ([Uri]$_.Url).Host } | Sort-Object -Unique
if ($base.Host -notin $domains) { $domains = @($base.Host) + $domains }
Write-Host "--- Domain connection times (ms) ---" -ForegroundColor Cyan
$domainStats = foreach ($d in $domains) { Measure-Domain $d }
$domainStats | Format-Table Domain, IP, DnsMs, TcpMs, TlsMs, Error -AutoSize

# 4. Time every resource
$i = 0
$results = foreach ($r in $resources) {
    $i++
    Write-Progress -Activity "Downloading resources" -Status "$i / $($resources.Count)  $($r.Url)" -PercentComplete (100 * $i / $resources.Count)
    $x = Get-Timed $r.Url $r.Type
    $x | Select-Object Type, Domain, Status, TtfbMs, TotalMs, KB, Encoding, Url, Cache, Error
}
Write-Progress -Activity "Downloading resources" -Completed

Write-Host "`n--- JS and CSS files, slowest first ---" -ForegroundColor Cyan
$results | Sort-Object TotalMs -Descending |
    Format-Table Type, TotalMs, TtfbMs, KB, Encoding, Status, @{n = "Url"; e = { if ($_.Url.Length -gt 80) { $_.Url.Substring(0, 77) + "..." } else { $_.Url } } } -AutoSize

Write-Host "--- Totals per domain ---" -ForegroundColor Cyan
$results | Group-Object Domain | ForEach-Object {
    [pscustomobject]@{
        Domain = $_.Name
        Files  = $_.Count
        TotalMs = ($_.Group | Measure-Object TotalMs -Sum).Sum
        TotalKB = [math]::Round(($_.Group | Measure-Object KB -Sum).Sum, 1)
    }
} | Sort-Object TotalMs -Descending | Format-Table -AutoSize

Write-Host "--- Totals per type ---" -ForegroundColor Cyan
$results | Group-Object Type | ForEach-Object {
    [pscustomobject]@{
        Type = $_.Name; Files = $_.Count
        TotalMs = ($_.Group | Measure-Object TotalMs -Sum).Sum
        TotalKB = [math]::Round(($_.Group | Measure-Object KB -Sum).Sum, 1)
    }
} | Format-Table -AutoSize

# 5. Likely problems
$issueList = New-Object System.Collections.Generic.List[string]
if ($page.TtfbMs -gt 600) { $issueList.Add(("Server is slow to respond: HTML TTFB {0} ms (aim for under 600). Check hosting, caching and CMS plugins." -f $page.TtfbMs)) }
$results | Where-Object { $_.Type -in "JS", "CSS" -and -not $_.Encoding -and $_.KB -gt 5 } | ForEach-Object { $issueList.Add(("Not compressed (no gzip/br): {0} ({1} KB)" -f $_.Url, $_.KB)) }
$results | Where-Object { $_.KB -gt 300 } | ForEach-Object { $issueList.Add(("Large file: {0} ({1} KB)" -f $_.Url, $_.KB)) }
$results | Where-Object { $_.TotalMs -gt 1000 } | ForEach-Object { $issueList.Add(("Slow download (over 1s): {0} ({1} ms)" -f $_.Url, $_.TotalMs)) }
$results | Where-Object { -not $_.Cache -and $_.Type -ne "HTML" } | Select-Object -First 3 | ForEach-Object { $issueList.Add(("No Cache-Control header: {0}" -f $_.Url)) }
$domainStats | Where-Object { ($_.DnsMs + $_.TcpMs + $_.TlsMs) -gt 400 } | ForEach-Object { $issueList.Add(("Slow connection setup to {0}: DNS {1} + TCP {2} + TLS {3} ms" -f $_.Domain, $_.DnsMs, $_.TcpMs, $_.TlsMs)) }
if ($domains.Count -gt 6) { $issueList.Add(("{0} separate domains - each needs its own DNS/TCP/TLS handshake." -f $domains.Count)) }

Write-Host "--- Things worth fixing ---" -ForegroundColor Cyan
if ($issueList.Count -eq 0) { Write-Host "Nothing obvious flagged." -ForegroundColor Green }
else { $issueList | ForEach-Object { Write-Host "* $_" -ForegroundColor Yellow } }

if ($Csv) { $results | Export-Csv -NoTypeInformation -Path $Csv; Write-Host "`nSaved $Csv" -ForegroundColor Green }

# 6. Markdown report
function ConvertTo-MdTable($rows, $cols) {
    $out = New-Object System.Collections.Generic.List[string]
    $out.Add("| " + (($cols | ForEach-Object { $_.Name }) -join " | ") + " |")
    $out.Add("|" + (($cols | ForEach-Object { if ($_.Right) { "---:" } else { "---" } }) -join "|") + "|")
    foreach ($row in $rows) {
        $cells = foreach ($c in $cols) {
            $v = $row.($c.Prop)
            if ($null -eq $v) { $v = "" }
            ([string]$v).Replace("|", "\|")
        }
        $out.Add("| " + ($cells -join " | ") + " |")
    }
    $out -join "`r`n"
}

try {
    if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $safeHost = $base.Host -replace '[^a-zA-Z0-9.-]', '_'
    $reportPath = Join-Path $LogDir "$safeHost`_$stamp.md"

    $totalKB = [math]::Round((($results | Measure-Object KB -Sum).Sum + $page.KB), 1)
    $totalMs = ($results | Measure-Object TotalMs -Sum).Sum
    $slowest = $results | Sort-Object TotalMs -Descending | Select-Object -First 1
    $failed  = @($results | Where-Object { $_.Error -or $_.Status -ge 400 })

    $domainRows = $results | Group-Object Domain | ForEach-Object {
        [pscustomobject]@{ Domain = $_.Name; Files = $_.Count
            TotalMs = ($_.Group | Measure-Object TotalMs -Sum).Sum
            TotalKB = [math]::Round(($_.Group | Measure-Object KB -Sum).Sum, 1) }
    } | Sort-Object TotalMs -Descending

    $typeRows = $results | Group-Object Type | ForEach-Object {
        [pscustomobject]@{ Type = $_.Name; Files = $_.Count
            TotalMs = ($_.Group | Measure-Object TotalMs -Sum).Sum
            TotalKB = [math]::Round(($_.Group | Measure-Object KB -Sum).Sum, 1) }
    }

    $md = New-Object System.Collections.Generic.List[string]
    $md.Add("# Page load timing report: $($base.Host)")
    $md.Add("")
    $md.Add("- **URL tested:** $Url")
    $md.Add("- **Run on:** $(Get-Date -Format 'dddd d MMMM yyyy, HH:mm') ($env:COMPUTERNAME)")
    $md.Add("- **Note:** timings are measured from this computer's network, with files downloaded one at a time, so treat them as relative comparisons rather than exact browser load times.")
    $md.Add("")
    $md.Add("## Summary")
    $md.Add("")
    $md.Add("| Measure | Value |")
    $md.Add("|---|---:|")
    $md.Add("| HTML time to first byte | $($page.TtfbMs) ms |")
    $md.Add("| HTML total download | $($page.TotalMs) ms ($($page.KB) KB) |")
    $md.Add("| Files found (JS/CSS$(if ($Images) { '/images' }))| $($results.Count) |")
    $md.Add("| Total size (HTML + files) | $totalKB KB |")
    $md.Add("| Combined file download time | $totalMs ms |")
    $md.Add("| Domains involved | $($domains.Count) |")
    $md.Add("| Failed or error files | $($failed.Count) |")
    if ($slowest) { $md.Add("| Slowest file | $($slowest.TotalMs) ms - $($slowest.Url) |") }
    $md.Add("")
    $md.Add("## Things worth fixing")
    $md.Add("")
    if ($issueList.Count -eq 0) { $md.Add("Nothing obvious flagged.") }
    else { $issueList | ForEach-Object { $md.Add("- $_") } }
    $md.Add("")
    $md.Add("## Domain connection times")
    $md.Add("")
    $md.Add((ConvertTo-MdTable $domainStats @(
        @{Name="Domain";Prop="Domain"}, @{Name="IP";Prop="IP"},
        @{Name="DNS (ms)";Prop="DnsMs";Right=$true}, @{Name="TCP (ms)";Prop="TcpMs";Right=$true},
        @{Name="TLS (ms)";Prop="TlsMs";Right=$true}, @{Name="Error";Prop="Error"})))
    $md.Add("")
    $md.Add("## Totals per domain")
    $md.Add("")
    $md.Add((ConvertTo-MdTable $domainRows @(
        @{Name="Domain";Prop="Domain"}, @{Name="Files";Prop="Files";Right=$true},
        @{Name="Total time (ms)";Prop="TotalMs";Right=$true}, @{Name="Total size (KB)";Prop="TotalKB";Right=$true})))
    $md.Add("")
    $md.Add("## Totals per file type")
    $md.Add("")
    $md.Add((ConvertTo-MdTable $typeRows @(
        @{Name="Type";Prop="Type"}, @{Name="Files";Prop="Files";Right=$true},
        @{Name="Total time (ms)";Prop="TotalMs";Right=$true}, @{Name="Total size (KB)";Prop="TotalKB";Right=$true})))
    $md.Add("")
    $md.Add("## All files, slowest first")
    $md.Add("")
    $md.Add((ConvertTo-MdTable ($results | Sort-Object TotalMs -Descending) @(
        @{Name="Type";Prop="Type"}, @{Name="Total (ms)";Prop="TotalMs";Right=$true},
        @{Name="TTFB (ms)";Prop="TtfbMs";Right=$true}, @{Name="Size (KB)";Prop="KB";Right=$true},
        @{Name="Compression";Prop="Encoding"}, @{Name="Status";Prop="Status";Right=$true},
        @{Name="URL";Prop="Url"})))
    $md.Add("")
    $md.Add("## Glossary")
    $md.Add("")
    $md.Add("- **DNS:** looking up the server's address from its domain name.")
    $md.Add("- **TCP / TLS:** opening the connection and securing it (https). Each extra domain repeats this.")
    $md.Add("- **TTFB:** time until the server starts sending a response; high values point to slow hosting or no caching.")
    $md.Add("- **Compression:** gzip/br shrink JS and CSS files. Blank means the file was sent uncompressed.")

    Set-Content -LiteralPath $reportPath -Value ($md -join "`r`n") -Encoding UTF8
    Write-Host "`nReport saved: $reportPath" -ForegroundColor Green
} catch {
    Write-Host "`nCould not save the report to '$LogDir': $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""
