"""Configuration management for Grip application."""

import os
import secrets
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings loaded from environment variables."""

    def __init__(self) -> None:
        self.supabase_url: str = os.getenv(
            "SUPABASE_URL", "https://your-project.supabase.co"
        )
        self.supabase_service_role_key: str = os.getenv(
            "SUPABASE_SERVICE_ROLE_KEY", "your-service-role-key"
        )

        self.app_env: str = os.getenv("APP_ENV", "development")

        # Signing key for the session cookie. Required in production.
        # In dev/testing we mint an ephemeral one so restarts invalidate sessions.
        self.session_secret: str = os.getenv("SESSION_SECRET", "")

        self._validate_config()

        if not self.session_secret:
            self.session_secret = secrets.token_urlsafe(32)
            print(
                "Warning: SESSION_SECRET not set, using an ephemeral random secret "
                "(sessions will not survive a restart)"
            )

    def _validate_config(self) -> None:
        valid_envs = {"development", "production", "testing"}
        if self.app_env.lower() not in valid_envs:
            raise ValueError(
                f"Invalid APP_ENV: {self.app_env}. Must be one of {valid_envs}"
            )

        if self.is_production:
            placeholder_values = [
                "your-project.supabase.co",
                "your-service-role-key",
            ]
            if any(
                value in [self.supabase_url, self.supabase_service_role_key]
                for value in placeholder_values
            ):
                raise ValueError(
                    "Production environment detected but Supabase credentials are placeholders"
                )
            if not self.session_secret:
                raise ValueError(
                    "Production environment detected but SESSION_SECRET is not set"
                )
        else:
            if not self.supabase_url or self.supabase_url.endswith(
                "your-project.supabase.co"
            ):
                print("Warning: SUPABASE_URL not set, using default placeholder")
            if (
                not self.supabase_service_role_key
                or self.supabase_service_role_key == "your-service-role-key"
            ):
                print(
                    "Warning: SUPABASE_SERVICE_ROLE_KEY not set, using default placeholder"
                )

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() == "development"

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


settings = Settings()
