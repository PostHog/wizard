/*
   PostHog Wizard – YARA Signature Rules

   Description: Detects wizard-specific content violations that Cedar
   structural rules can't express. These complement the base YARA rules
   compiled into the harness binary (prompt injection, exfiltration,
   secrets detection, etc.) with PostHog-specific patterns.

   Author: PostHog
   Date: 2026-02-28

   Rules:
     §1  PostHog API – PII in capture calls, hardcoded keys, autocapture
     §2  Prompt injection – wizard-specific override detection
     §3  Secret exfiltration – command-based credential theft
*/

// ═══════════════════════════════════════════════════════
// §1  PostHog API Violations
// ═══════════════════════════════════════════════════════
//
// Enforce wizard commandments that are specific to PostHog
// SDK usage. These fire on agent-written code (post-execution
// on FileWrite/Edit results).

rule pii_in_capture_call {
    meta:
        description = "Detects PII fields passed to posthog.capture() — violates 'NEVER send PII in capture()' commandment"
        severity = "high"
        category = "posthog_pii"
        mitre_attack = "T1537"
        applies_to = "PostToolUse:FileWrite,PostToolUse:FileEdit"

    strings:
        // Direct PII field names in capture properties
        $email = /\.capture\s*\([^)]{0,200}email/i
        $phone = /\.capture\s*\([^)]{0,200}phone/i
        $fullname = /\.capture\s*\([^)]{0,200}full[_\s]?name/i
        $firstname = /\.capture\s*\([^)]{0,200}first[_\s]?name/i
        $lastname = /\.capture\s*\([^)]{0,200}last[_\s]?name/i
        $address = /\.capture\s*\([^)]{0,200}(street|mailing|home|billing)[_\s]?address/i
        $ssn = /\.capture\s*\([^)]{0,200}(ssn|social[_\s]?security)/i
        $dob = /\.capture\s*\([^)]{0,200}(date[_\s]?of[_\s]?birth|dob|birthday)/i
        $ip = /\.capture\s*\([^)]{0,200}\$ip/

        // PII in identify() properties (also a violation)
        $identify_email = /\.identify\s*\([^)]{0,200}email/i
        $identify_phone = /\.identify\s*\([^)]{0,200}phone/i

        // PII in $set properties via capture
        $set_email = /\$set.*email/i
        $set_phone = /\$set.*phone/i

    condition:
        any of ($email, $phone, $fullname, $firstname, $lastname,
                $address, $ssn, $dob, $ip) or
        any of ($identify_email, $identify_phone) or
        any of ($set_email, $set_phone)
}

rule hardcoded_posthog_key {
    meta:
        description = "Detects hardcoded PostHog API keys in source — violates 'use environment variables' commandment"
        severity = "high"
        category = "posthog_hardcoded_key"
        mitre_attack = "T1552.001"
        applies_to = "PostToolUse:FileWrite,PostToolUse:FileEdit"

    strings:
        // PostHog project API key (phc_ prefix, 20+ alphanumeric chars)
        $phc_key = /phc_[a-zA-Z0-9]{20,}/

        // PostHog personal API key (phx_ prefix)
        $phx_key = /phx_[a-zA-Z0-9]{20,}/

        // Hardcoded key assignment patterns (key in quotes assigned to variable)
        $key_assign1 = /apiKey\s*[:=]\s*['"][a-zA-Z0-9_]{20,}['"]/
        $key_assign2 = /api_key\s*[:=]\s*['"][a-zA-Z0-9_]{20,}['"]/
        $key_assign3 = /POSTHOG_KEY\s*[:=]\s*['"][a-zA-Z0-9_]{20,}['"]/

    condition:
        any of ($phc_key, $phx_key) or
        any of ($key_assign1, $key_assign2, $key_assign3)
}

rule autocapture_disabled {
    meta:
        description = "Detects agent disabling autocapture — violates 'don't disable autocapture' commandment"
        severity = "medium"
        category = "posthog_autocapture"
        applies_to = "PostToolUse:FileWrite,PostToolUse:FileEdit"

    strings:
        // Direct boolean false
        $disabled_js1 = /autocapture\s*:\s*false/
        $disabled_js2 = /autocapture\s*:\s*'false'/
        $disabled_js3 = /autocapture\s*:\s*"false"/

        // Python SDK
        $disabled_py = /autocapture\s*=\s*False/

        // Config object assignment
        $disabled_config = /disable_autocapture\s*[:=]\s*(true|True|1)/

    condition:
        any of them
}

// ═══════════════════════════════════════════════════════
// §2  Prompt Injection – Wizard-Specific
// ═══════════════════════════════════════════════════════
//
// Supplements the base harness prompt injection rules
// (pi.yar) with patterns specific to the wizard's
// domain. These fire on file content read by the agent.

rule prompt_injection_wizard_override {
    meta:
        description = "Detects prompt injection attempting to override wizard behavior in project files"
        severity = "critical"
        category = "prompt_injection"
        mitre_attack = "T1059"
        applies_to = "PostToolUse:FileRead,PostToolUse:Grep"

    strings:
        // Direct instruction override
        $ignore1 = "ignore previous instructions" nocase
        $ignore2 = "disregard all" nocase
        $ignore3 = "forget your instructions" nocase
        $ignore4 = "override your rules" nocase

        // Role manipulation
        $role1 = "you are now" nocase
        $role2 = "act as a different" nocase
        $role3 = "new instructions:" nocase

        // Wizard-specific manipulation
        $wizard1 = "skip posthog" nocase
        $wizard2 = "do not install posthog" nocase
        $wizard3 = "remove posthog" nocase
        $wizard4 = "uninstall posthog" nocase
        $wizard5 = "delete the posthog" nocase

        // Tool abuse via file content
        $tool1 = "run the following command" nocase
        $tool2 = "execute this shell command" nocase

    condition:
        any of ($ignore*) or
        any of ($role*) or
        any of ($wizard*) or
        any of ($tool*)
}

// ═══════════════════════════════════════════════════════
// §3  Secret Exfiltration via Commands
// ═══════════════════════════════════════════════════════
//
// Detect attempts to exfiltrate secrets through shell
// commands. Fires pre-execution on Bash tool input.

rule secret_exfiltration_via_command {
    meta:
        description = "Detects shell commands attempting to exfiltrate secrets or credentials"
        severity = "critical"
        category = "exfiltration"
        mitre_attack = "T1041"
        applies_to = "PreToolUse:Bash"

    strings:
        // curl/wget with environment variable secrets
        $curl_env = /curl\s+.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i
        $wget_env = /wget\s+.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i

        // Piping secrets to network tools
        $pipe_curl = /\|\s*curl/
        $pipe_wget = /\|\s*wget/
        $pipe_nc = /\|\s*nc\s/
        $pipe_netcat = /\|\s*netcat\s/

        // Base64 encoding piped to network (classic exfil pattern)
        $b64_pipe = /base64.*\|\s*(curl|wget|nc\s)/i

        // Reading .env and sending
        $env_send = /cat\s+.*\.env.*\|\s*(curl|wget)/

        // PostHog key exfiltration specifically
        $phc_curl = /curl.*phc_[a-zA-Z0-9]/
        $phc_wget = /wget.*phc_[a-zA-Z0-9]/

    condition:
        any of them
}
