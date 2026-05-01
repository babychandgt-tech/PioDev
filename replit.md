# PioCode

## Overview
PioCode is a React and Supabase-based AI chatbot platform, designed to offer a comprehensive suite of AI-powered creative and productivity tools. It aims to provide a robust, scalable, and user-friendly experience for AI-driven content generation, including advanced conversational AI, image generation, video creation, and voice synthesis. The project emphasizes a tiered access model (Free, Plus, Pro) to cater to diverse user needs, offering escalating capabilities and quotas. Key ambitions include seamless user experience, powerful AI integrations, and a flexible architecture to support future expansions.

## User Preferences
- The user prefers clear and concise information.
- The user prefers an iterative development approach, with clear communication before major changes.
- The user wants the agent to prioritize high-level architectural and design decisions over granular implementation details in discussions.
- The user wants the agent to be explicit about external dependencies and their integration points.

## System Architecture
PioCode is built as a monorepo using pnpm workspaces. The frontend is developed with React 19, Vite, Tailwind CSS v4, Wouter for routing, and Framer Motion for animations. UI components leverage Radix UI and shadcn patterns, with `react-markdown` and `react-syntax-highlighter` for markdown rendering.

**Key Features and Implementations:**
-   **AI Chat:** Features streaming, "thinking" mode, web search, and code artifact display. It uses a background generation mechanism where the client polls the server for updates, allowing for refresh-safe generation. This involves `POST /api/chat/bg-generate` for initial request and `GET /api/chat/bg-poll/:msgId` for polling.
-   **Image Generation:** Integrates Qwen Image models with daily quotas based on user tier.
-   **Video Studio:** Provides text-to-video and image-to-video capabilities (Wan series models) with monthly credits.
-   **Voice Studio:** Offers Text-to-Speech (TTS), voice cloning, and voice design using Qwen3-TTS family models. It includes a TTS Playground, Voice Cloning (via DashScope `voice-enrollment`), Voice Design (via DashScope `qwen-voice-design`), and a "My Voices" section. Monthly voice credits are tier-aware.
-   **Artifact Panel:** Allows direct preview of HTML/CSS/JS code within chat.
-   **Admin Dashboard:** Features Role-Based Access Control (RBAC), user management (tier assignment, credit adjustments), and dynamic pricing configuration, backed by a `app_config` table.
-   **Personalization:** Users can set custom system prompts and persona settings.
-   **Pricing and Tiers:** Implements a three-tier system (Free, Plus, Pro) with varying token limits, feature access, and quotas for image generation, video credits, voice studio credits, and Pustaka (knowledge base) usage. Tier-specific logic is enforced server-side. The Plus Free Trial offers a one-month trial with bonus credit.
-   **API Keys (BYOK):** Plus and Pro users can generate encrypted API keys for external access to PioCode API, with tier-gating for specific models.
-   **Credit System:** A persistent credit balance (IDR) for users, managed via `profiles.credit_balance_idr` and `credit_transactions` ledger. Credit conversion is 2 tokens = Rp 1, with fixed rates for image and video generation. Bonuses are granted upon tier upgrades and trial claims.
-   **Pustaka (Knowledge Base):** Users can upload reusable documents with tier-based limits on file size, count, and page processing. Parsing supports text, code, JSON, Markdown, PDF, and images using Azure Document Intelligence. Documents are stored in a Supabase bucket.

**Data Persistence:**
-   Supabase serves as the backend for authentication and PostgreSQL database.
-   Key tables include `conversations`, `messages`, `profiles`, `video_jobs`, `user_voices`, `app_config`, `credit_transactions`, `documents`, and `document_page_usage`.
-   RLS (Row Level Security) is extensively used across tables for data isolation.

**Server-side Logic:**
-   An Express server acts as a proxy for DashScope API, handles authentication, admin endpoints, and complex business logic like background AI generation, credit management, and quota enforcement.

## External Dependencies
-   **Supabase:** Primary backend for authentication, PostgreSQL database, and file storage (storage buckets for Pustaka documents).
-   **DashScope API (Alibaba Cloud):** Core AI engine for:
    -   Qwen models (chat, image generation).
    -   Wan series models (video generation).
    -   Qwen3-TTS family models (Text-to-Speech, voice cloning, voice design).
    -   `voice-enrollment` (for voice cloning).
    -   `qwen-voice-design` (for voice design).
-   **Azure Document Intelligence:** Used for parsing and extracting text from PDF and image files in the Pustaka feature (`prebuilt-read` model).
-   **Azure Speech:** Used for general voice mode in chat (separate from Voice Studio).
-   **Tailwind CSS:** Frontend styling framework.
-   **Radix UI / shadcn:** UI component library.
-   **Vite:** Frontend build tool.
-   **Framer Motion:** Animation library.
-   **Wouter:** Routing library.
-   **react-markdown, react-syntax-highlighter:** Markdown rendering.
-   **multer:** For handling multipart form data uploads (e.g., in Pustaka).