# FlowKit

LocalAnt skill for controlling a running FlowKit server.

Prerequisites:

1. Start FlowKit locally, usually with `python -m agent.main`.
2. Load the FlowKit Chrome extension and open Google Flow.
3. Confirm `flowkit_health` returns `extension_connected: true`.

The skill defaults to `http://127.0.0.1:8100`. Pass `baseUrl` to any tool when FlowKit is running elsewhere.

Typical flow:

1. `flowkit_create_workflow`
2. `flowkit_generate_references`
3. `flowkit_generate_images`
4. `flowkit_generate_videos`
5. `flowkit_poll`

Generation tools submit batch requests; FlowKit handles throttling internally.
