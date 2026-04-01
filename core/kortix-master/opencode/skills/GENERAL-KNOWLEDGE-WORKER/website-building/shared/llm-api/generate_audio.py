"""Provider-agnostic text-to-speech stub.

Copy this into a project and wire it to the TTS SDK or HTTP API that the
project actually uses.

If the runtime has the `elevenlabs` skill installed, prefer that skill for
text-to-speech and voice workflows before writing custom provider glue.
"""


async def generate_audio(
    text: str,
    *,
    voice: str = "<voice>",
    model: str = "<tts-model>",
) -> bytes:
    raise NotImplementedError(
        "Implement this function with the project's real TTS provider SDK or API. "
        "Pass text, voice, and model, then return raw audio bytes."
    )


async def generate_dialogue(
    dialogue: list[dict],
    *,
    model: str = "<tts-model>",
) -> bytes:
    raise NotImplementedError(
        "Implement this function with the project's real TTS provider SDK or API. "
        "Pass a list of speaker/text turns and return raw audio bytes."
    )
