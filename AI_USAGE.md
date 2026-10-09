# AI Usage

## How AI was used

I used OpenAI Codex to understand the assessment, build the application, review bugs, and implement the later change request. I discussed the requirements in Bengali and asked for simple explanations before moving on to development.

The AI helped with:

- Explaining the backend, frontend, PostgreSQL, and MQTT responsibilities.
- Reading the assessment PDF and documenting unclear or conflicting rules.
- Setting up the local database connection and connecting the supplied GitHub repository.
- Implementing the existing Node.js/Express modular monolith, PostgreSQL storage, MQTT worker, and dashboard.
- Reviewing bugs, adding regression tests, running local broker and browser checks, and preparing submission files.
- Applying the change request: COUNT quantities from 1 to 500, persistent rejected-submission totals, a production-source input, and a seventh dashboard indicator.

## My input and decisions

I provided the assessment, repository URL, local database setup, and employee ID `08`. I asked for meaningful commits, complete implementation, a careful bug review, and changes to the existing application. I entered the database credentials locally; they are kept in the ignored `.env` file.

I also asked for short, clear explanations and an English conversation record suitable for the interview submission. The framework choice and interpretations of conflicting requirements are documented in [TECHNICAL_EXPLANATION.md](TECHNICAL_EXPLANATION.md).

## Checks and limitations

The updated version passes 55 automated tests and 20 browser checks. These use temporary PostgreSQL databases and a real local MQTT broker. They cover accepted and rejected counts, source filtering, persistence, existing VOID/ACK behavior, retries, errors, and mobile layout.

The external assessment broker has not been tested because permission to send database-derived results to that destination is still pending. The optional Protocol Buffers bonus was not implemented. No claim of writing the entire application without AI assistance is made.

## Conversation record

[AI_CONVERSATION.md](AI_CONVERSATION.md) contains English translations and condensed summaries of the actual conversation. Related messages are grouped to keep the record short. It is not a verbatim chat export, and it does not include passwords or tool logs.
