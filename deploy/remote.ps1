param([Parameter(Mandatory=$true)][string]$Script,[string[]]$Upload,[string[]]$Download)
$OutputEncoding=[System.Text.UTF8Encoding]::new($false);$settings=@{}; foreach($line in [IO.File]::ReadAllLines((Join-Path $PSScriptRoot '../prod.txt'))){if($line -match '^\s*([^:=：]+)\s*[:=：]\s*(.+)$'){$settings[$matches[1].Trim()]=$matches[2].Trim()}}
if($settings['IP'] -ne '121.196.246.211'){throw '拒绝未知生产主机'}
$key='C:\Users\27861\.ssh\wgroup_prod_ed25519_20261001';$known='C:\Users\27861\.ssh\codex-prod-20261001-known_hosts';$target=$settings['用户名']+'@'+$settings['IP'];
$argsCommon=@('-i',$key,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',"UserKnownHostsFile=$known",'-o','ConnectTimeout=15');
if($Upload){& scp @argsCommon -P 22 -- $Upload[0] ($target+':'+$Upload[1]);if($LASTEXITCODE){exit $LASTEXITCODE}}
if($Download){& scp @argsCommon -P 22 -- ($target+':'+$Download[0]) $Download[1];if($LASTEXITCODE){exit $LASTEXITCODE}}
if($Script -ne '-'){
$operation='/tmp/mes-op-'+[guid]::NewGuid().ToString('N');
& ssh @argsCommon -p 22 $target ("umask 077; mkdir "+$operation);if($LASTEXITCODE){exit $LASTEXITCODE}
$normalized=[IO.Path]::GetTempFileName();[IO.File]::WriteAllText($normalized,([IO.File]::ReadAllText((Resolve-Path $Script))).Replace("`r`n","`n").TrimStart([char]0xfeff),[Text.UTF8Encoding]::new($false));
& scp @argsCommon -P 22 -- $normalized ($target+':'+$operation+'/run.sh');Remove-Item -LiteralPath $normalized;if($LASTEXITCODE){exit $LASTEXITCODE}
& ssh @argsCommon -p 22 $target ("bash "+$operation+'/run.sh; result=$?; rm -f '+$operation+'/run.sh; rmdir '+$operation+'; exit $result');exit $LASTEXITCODE
}
