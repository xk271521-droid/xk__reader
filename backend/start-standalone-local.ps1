$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Developer-local mode uses the existing local MySQL database. The packaged
# standalone installer has its own backendOrigin/standalone flag and should
# not reuse this launcher or redirect this development checkout to fresh SQLite.
$env:XK_READER_STANDALONE = $null
$env:XK_READER_USE_LOCAL_DATABASE = 'true'
$env:XK_READER_DATA_DIR = if ($env:XK_READER_DATA_DIR) { $env:XK_READER_DATA_DIR } else { Join-Path $projectRoot 'data' }
$env:FULL_TRANSLATION_ENABLED = 'true'
$env:UPLOADS_DIR = Join-Path $env:XK_READER_DATA_DIR 'uploads'
$env:PAPERS_UPLOAD_DIR = Join-Path $env:XK_READER_DATA_DIR 'uploads\papers'
$env:FULL_TRANSLATION_OUTPUT_DIR = Join-Path $env:XK_READER_DATA_DIR 'uploads\full-translations'
$env:UPLOAD_PUBLIC_BASE_URL = ''
$env:UPLOAD_MIRROR_ENABLED = 'false'
$env:OSS_ENABLED = 'false'

& (Join-Path $projectRoot 'start-local-backend.ps1')
