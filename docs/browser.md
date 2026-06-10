# Browser Automation

Playwright-based browser control. Playwright is an **optional** peer dependency
to keep the base install light:

```bash
npm i -D playwright && npx playwright install chromium
```

If Playwright is missing, browser tools return clear install guidance.

## Safety

- A **dedicated, isolated** browser profile is used by default — never your
  day-to-day Chrome profile.
- Using a login-capable profile requires explicit opt-in via
  `browser_use_profile({ useLoginProfile: true })` and triggers a warning.
- All browser control is **risk 3** (approval required).

## Tools

```
browser_open({ url })          browser_close()
browser_screenshot()           browser_save_pdf()
browser_extract_text({ selector }) browser_get_html()
browser_click({ selector })    browser_type({ selector, text })
browser_wait_for({ selector, timeoutMs })
browser_use_profile({ useLoginProfile })
```

Screenshots and PDFs are saved into the workspace directory.
