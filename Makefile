.PHONY: help install lint format type-check ci clean clear server check

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	uv sync

lint: ## Run linting with ruff and fix errors
	uv run ruff check . --fix

format: ## Format code with ruff
	uv run ruff format .

type-check: ## Run type checking with mypy
	uv run mypy grip

check: lint type-check ## Run all checks (lint, type-check)

server: ## Start the development server
	uv run python -m grip.main

ci: ## Run CI pipeline locally (install, lint, format-check, type-check, security)
	@echo "Running CI pipeline checks..."
	@echo "Installing dependencies..."
	uv sync --dev
	uv pip install -e .
	@echo "Running lint check..."
	uv run ruff check .
	@echo "Running format check..."
	uv run ruff format --check .
	@echo "Running type check..."
	uv run mypy grip
	@echo "Running security check..."
	uv run ruff check grip --select S
	@echo "✅ All CI checks passed!"

clean: ## Clean up generated files
	rm -rf .mypy_cache
	rm -rf .ruff_cache

clear: clean ## Alias for clean
