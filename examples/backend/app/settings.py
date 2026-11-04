"""Backend configuration, read from the environment and `.env`."""

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Model provider SDKs (e.g. openai) read their API keys straight from
# os.environ, so `.env` is loaded into the process environment rather than
# only into Settings.
load_dotenv()


class Settings(BaseSettings):
    openai_model: str = "openai-chat:gpt-4o"


settings = Settings()
