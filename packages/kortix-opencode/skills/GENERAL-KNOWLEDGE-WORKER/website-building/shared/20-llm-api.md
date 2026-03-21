# LLM & Media API Access

Use this reference when a website or web app needs LLM, image, video, or audio features.

## Core Rule

Use real SDKs and real environment variables. Do not assume proxy credentials or hidden runtime injection. If a feature depends on an API key, require the matching env var before wiring the feature.

## Common SDKs

- Anthropic Python/Node SDKs
- OpenAI Python/Node SDKs
- Any additional provider SDK explicitly installed by the project

## Environment Variables

Typical examples:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- provider-specific keys for image, audio, or video services

If a project needs these services, document the required env vars clearly and fail fast when they are missing.

## Local Development Pattern

1. Add the required env vars to the local environment.
2. Start the app server with `pty_spawn`.
3. Verify the feature end-to-end with the local URL and browser QA.

## Implementation Guidance

- Use the official provider SDK unless there is a strong reason not to.
- Keep model names configurable instead of hard-coding one provider forever.
- Avoid promising media generation or transcription capabilities unless the project actually has the credentials and implementation wired up.
