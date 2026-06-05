# 同步推送当前分支到 GitHub (origin) 与 Gitee (gitee)
# 用法: .\scripts\mirror-push.ps1 [分支名，默认 H5Branch]

param(
    [string]$Branch = "H5Branch"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

$remotes = git remote
if ($remotes -notcontains "origin") {
    Write-Error "未找到 origin 远程，请先配置 GitHub remote。"
}
if ($remotes -notcontains "gitee") {
    Write-Error "未找到 gitee 远程。请先执行: git remote add gitee https://gitee.com/你的用户名/AIChater.git"
}

Write-Host ">>> 推送到 origin ($Branch) ..."
git push origin $Branch
Write-Host ">>> 推送到 gitee ($Branch) ..."
git push gitee $Branch
Write-Host ">>> 双端推送完成。"
