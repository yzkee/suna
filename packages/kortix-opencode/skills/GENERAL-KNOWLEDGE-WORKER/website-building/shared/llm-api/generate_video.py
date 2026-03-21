"""Provider-agnostic video generation stub.

Copy this into a project and wire it to the video generation SDK or HTTP API
that the project actually uses.
"""


async def generate_video(
    prompt: str,
    *,
    image_bytes: bytes | None = None,
    image_media_type: str | None = None,
    aspect_ratio: str = "16:9",
    duration: int = 8,
    audio: bool = True,
    model: str = "<video-model>",
) -> bytes:
    raise NotImplementedError(
        "Implement this function with the project's real video provider SDK or API. "
        "Pass prompt, optional source image bytes, aspect ratio, duration, audio flag, and model, then return raw video bytes."
    )
