"""Provider-agnostic speech-to-text stub.

Copy this into a project and wire it to the transcription SDK or HTTP API that
the project actually uses.

If the runtime has the `elevenlabs` skill installed, prefer that skill for
speech transcription or diarization before writing custom provider glue.
"""


async def transcribe_audio(
    audio_bytes: bytes,
    *,
    media_type: str = "audio/mpeg",
    timestamps: str = "none",
    diarize: bool = False,
    num_speakers: int | None = None,
    language: str | None = None,
    model: str = "<stt-model>",
) -> dict:
    raise NotImplementedError(
        "Implement this function with the project's real transcription provider SDK or API. "
        "Return a dict containing transcript text, optional language code, and optional word-level timing/speaker data."
    )
