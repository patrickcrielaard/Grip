"""Configuration management for Grip application."""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings loaded from environment variables."""

    def __init__(self) -> None:
        self.supabase_url: str = os.getenv(
            "SUPABASE_URL", "https://your-project.supabase.co"
        )
        self.supabase_anon_key: str = os.getenv("SUPABASE_ANON_KEY", "your-anon-key")
        self.supabase_service_role_key: str = os.getenv(
            "SUPABASE_SERVICE_ROLE_KEY", "your-service-role-key"
        )

        self.app_name: str = os.getenv("APP_NAME", "Grip")
        self.app_env: str = os.getenv("APP_ENV", "development")

        self._validate_config()

    def _validate_config(self) -> None:
        valid_envs = {"development", "production", "testing"}
        if self.app_env.lower() not in valid_envs:
            raise ValueError(
                f"Invalid APP_ENV: {self.app_env}. Must be one of {valid_envs}"
            )

        if self.is_production:
            placeholder_values = [
                "your-project.supabase.co",
                "your-anon-key",
                "your-service-role-key",
            ]
            if any(
                value
                in [
                    self.supabase_url,
                    self.supabase_anon_key,
                    self.supabase_service_role_key,
                ]
                for value in placeholder_values
            ):
                raise ValueError(
                    "Production environment detected but Supabase credentials are placeholders"
                )
        else:
            if not self.supabase_url or self.supabase_url.endswith(
                "your-project.supabase.co"
            ):
                print("Warning: SUPABASE_URL not set, using default placeholder")
            if not self.supabase_anon_key or self.supabase_anon_key == "your-anon-key":
                print("Warning: SUPABASE_ANON_KEY not set, using default placeholder")
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

    @property
    def is_testing(self) -> bool:
        return self.app_env.lower() == "testing"


settings = Settings()
