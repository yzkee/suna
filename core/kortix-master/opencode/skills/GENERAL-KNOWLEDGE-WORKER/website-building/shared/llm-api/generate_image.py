"""Provider-agnostic image generation stub.

Copy this into a project and wire it to the image generation SDK or HTTP API
that the project actually uses.
"""


async def generate_image(
    prompt: str,
    *,
    image_bytes: bytes | None = None,
    image_media_type: str | None = None,
    aspect_ratio: str = "1:1",
    model: str = "<image-model>",
) -> bytes:
    raise NotImplementedError(
        "Implement this function with the project's real image provider SDK or API. "
        "Pass prompt, optional source image bytes, aspect ratio, and model, then return raw image bytes."
    )
