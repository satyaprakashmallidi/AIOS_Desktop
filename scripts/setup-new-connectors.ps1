# Composio + Supabase setup for the 27 new connectors (v0.1.26 connectors-expansion).
#
# Prerequisites:
#   - $env:COMPOSIO_API_KEY = "ak_xxx..."   (your Composio master key)
#   - npx supabase CLI logged in (npx supabase login if not)
#   - run from repo root
#
# What it does (per toolkit, idempotent on the supabase side):
#   1. POST /api/v3/auth_configs to create a Composio-managed auth_config
#   2. PATCH /api/v3/auth_configs/<id> to set type=default,
#      is_enabled_for_tool_router=true
#   3. npx supabase secrets set COMPOSIO_AUTH_<SLUG_UPPER>=<ac_id>
#
# At the end it deploys aios-relay so the new env vars take effect.

if (-not $env:COMPOSIO_API_KEY) {
    Write-Error "COMPOSIO_API_KEY env var not set."
    exit 1
}

# Toolkits: Composio uppercase slug + the env-var suffix used by the relay.
# Relay computes envSuffix from the catalog slug as toUpperCase().replace('-','_').
$toolkits = @(
    @{ slug = "SUPABASE";      envSuffix = "SUPABASE"     },
    @{ slug = "GOOGLEDRIVE";   envSuffix = "GOOGLE_DRIVE" },
    @{ slug = "AIRTABLE";      envSuffix = "AIRTABLE"     },
    @{ slug = "FIRECRAWL";     envSuffix = "FIRECRAWL"    },
    @{ slug = "DISCORD";       envSuffix = "DISCORD"      },
    @{ slug = "ONE_DRIVE";     envSuffix = "ONEDRIVE"     },
    @{ slug = "EXA";           envSuffix = "EXA"          },
    @{ slug = "ELEVENLABS";    envSuffix = "ELEVENLABS"   },
    @{ slug = "SALESFORCE";    envSuffix = "SALESFORCE"   },
    @{ slug = "CALENDLY";      envSuffix = "CALENDLY"     },
    @{ slug = "GOOGLEMEET";    envSuffix = "GOOGLE_MEET"  },
    @{ slug = "ZOHO";          envSuffix = "ZOHO"         },
    @{ slug = "DROPBOX";       envSuffix = "DROPBOX"      },
    @{ slug = "HEYGEN";        envSuffix = "HEYGEN"       },
    @{ slug = "YOUSEARCH";     envSuffix = "YOUSEARCH"    },
    @{ slug = "RETELLAI";      envSuffix = "RETELLAI"     },
    @{ slug = "CANVA";         envSuffix = "CANVA"        },
    @{ slug = "CAL";           envSuffix = "CAL_COM"      },
    @{ slug = "TELNYX";        envSuffix = "TELNYX"       },
    @{ slug = "CLOUDFLARE";    envSuffix = "CLOUDFLARE"   },
    @{ slug = "REDDIT";        envSuffix = "REDDIT"       },
    @{ slug = "CLOUDINARY";    envSuffix = "CLOUDINARY"   },
    @{ slug = "CONVEX";        envSuffix = "CONVEX"       },
    @{ slug = "DOCKER_HUB";    envSuffix = "DOCKERHUB"    },
    @{ slug = "EXCEL";         envSuffix = "EXCEL"        },
    @{ slug = "GOOGLE_MAPS";   envSuffix = "GOOGLE_MAPS"  }
)

$results = @()

foreach ($t in $toolkits) {
    $slug = $t.slug
    $envSuffix = $t.envSuffix
    $name = "$($slug.ToLower())-default"

    Write-Host ""
    Write-Host "===> $slug" -ForegroundColor Cyan

    # 1. Create the auth_config
    $createBody = @{
        toolkit = @{ slug = $slug }
        auth_config = @{
            type = "use_composio_managed_auth"
            name = $name
        }
    } | ConvertTo-Json -Depth 5

    try {
        $created = Invoke-RestMethod `
            -Uri "https://backend.composio.dev/api/v3/auth_configs" `
            -Method Post `
            -Headers @{ "x-api-key" = $env:COMPOSIO_API_KEY; "Content-Type" = "application/json" } `
            -Body $createBody `
            -ErrorAction Stop
        $acId = $created.auth_config.id
        Write-Host "  created $acId"
    } catch {
        Write-Host "  create failed: $($_.Exception.Message)" -ForegroundColor Yellow
        $results += [pscustomobject]@{ slug = $slug; ok = $false; reason = "create-failed" }
        continue
    }

    # 2. Patch to default + tool-router-enabled
    $patchBody = @{
        type = "default"
        is_enabled_for_tool_router = $true
    } | ConvertTo-Json

    try {
        Invoke-RestMethod `
            -Uri "https://backend.composio.dev/api/v3/auth_configs/$acId" `
            -Method Patch `
            -Headers @{ "x-api-key" = $env:COMPOSIO_API_KEY; "Content-Type" = "application/json" } `
            -Body $patchBody `
            -ErrorAction Stop | Out-Null
        Write-Host "  patched: default + tool-router-enabled"
    } catch {
        Write-Host "  patch failed: $($_.Exception.Message)" -ForegroundColor Yellow
        $results += [pscustomobject]@{ slug = $slug; ok = $false; reason = "patch-failed"; acId = $acId }
        continue
    }

    # 3. Set the supabase secret
    $envName = "COMPOSIO_AUTH_$envSuffix"
    Write-Host "  npx supabase secrets set $envName=$acId"
    & npx supabase secrets set "$envName=$acId" 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  supabase secret set failed (exit $LASTEXITCODE)" -ForegroundColor Yellow
        $results += [pscustomobject]@{ slug = $slug; ok = $false; reason = "secret-set-failed"; acId = $acId; envName = $envName }
        continue
    }

    $results += [pscustomobject]@{ slug = $slug; ok = $true; acId = $acId; envName = $envName }
}

Write-Host ""
Write-Host "===> Summary" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$failures = $results | Where-Object { -not $_.ok }
if ($failures) {
    Write-Host "$($failures.Count) failure(s). Fix and re-run." -ForegroundColor Yellow
}

# 4. Deploy the relay so the new env vars take effect
Write-Host ""
Write-Host "===> Deploying aios-relay" -ForegroundColor Cyan
& npx supabase functions deploy aios-relay --no-verify-jwt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Relay deploy failed. Run manually: npx supabase functions deploy aios-relay --no-verify-jwt" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Now restart the desktop app so the renderer picks up the new connector cards."
