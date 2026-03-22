# Contributing to AdminBot

Thanks for your interest in contributing! Here's how you can help.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/HaydarOzturk/AiAdminBot.git`
3. Install dependencies: `npm install`
4. Copy `.env.example` to `.env` and fill in your bot credentials
5. Run `npm run deploy` to register slash commands
6. Start development: `npm run dev`

## Project Structure

```
src/
  commands/       # Slash commands (grouped by category)
  events/         # Discord event handlers
  systems/        # Core systems (verification, setup, AI, leveling, etc.)
  handlers/       # Command & event loaders
  utils/          # Shared utilities (database, embeds, locale, logger, etc.)
locales/          # Translation files (tr, en, de, es, fr, pt, ru, ar)
config/           # Example configuration files
```

## Adding a New Command

1. Create a new file in `src/commands/<category>/your-command.js`
2. Export a `data` (SlashCommandBuilder) and `execute(interaction)` function
3. Use `t()` for all user-facing strings (see `src/utils/locale.js`)
4. Run `npm run deploy` to register the new command

## Adding a New Language

1. Copy `locales/en.json` to `locales/<code>.json`
2. Translate all values (keep keys in English)
3. Add the language choice to `src/commands/ai/ai-setup.js`
4. Test with `LOCALE=<code> npm start`

## Code Style

- Use English for all code comments and variable names
- Use `t()` for all user-facing strings (never hardcode messages)
- Use `channelName()` for Discord channel name references
- Slash command descriptions should be in English
- Keep functions small and focused

## Submitting Changes

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes and test them
3. Commit with a clear message: `git commit -m "Add: description of change"`
4. Push and open a Pull Request

## Reporting Issues

- Use GitHub Issues
- Include your Node.js version, OS, and bot version
- Attach relevant log files from the `logs/` directory
- Describe steps to reproduce the issue

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
