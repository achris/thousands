# thousands

A Foundry VTT module for the Pathfinder Second Edition system that supports a Strength of Thousands campaign, centered on the academia subsystem.

Targets Foundry VTT 14 (verified on 14.370) and the PF2e system 8.7.0 or later.

## Local development

Requires Node.js 22 or later.

```sh
npm ci
npm run lint        # ESLint and Prettier check
npm run typecheck   # TypeScript
npm test            # Vitest, including a build of dist/ and a manifest check
npm run build       # writes the module to dist/
npm run format      # apply Prettier
```

## Installing locally

The repository is private, so there is no manifest URL yet. Build the module, then copy or
symlink `dist/` into Foundry's user data as `Data/modules/thousands`:

```sh
npm run build
ln -s "$(pwd)/dist" "<Foundry user data>/Data/modules/thousands"
```

Use `cp -r dist <Foundry user data>/Data/modules/thousands` instead of a symlink if you prefer a
copy. Restart Foundry, then enable **Strength of Thousands** in a PF2e world.
