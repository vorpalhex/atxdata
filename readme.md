# ATX Data

Tools for monitoring Austin City Council activity.

This is intended primarily to be *driven* by an LLM agent such as Codex/Claude/etc, so that non-technical users can get at the Austin City Council documents, make sense of them, and use an LLM to do interpretation and discovery. Your LLM will need a way to run commands, so a purely chat interface won't quite do it, but your chat LLM should be able to guide you to the right thing. 

Give the URL of this repo: https://github.com/vorpalhex/atxdata to your LLM and ask it to help you get this project going. Give it a city council meeting date (near dates are fine, it can search for exact dates) and ask it to start getting documents and producing highlight reports. If you're stuck, reach out for help in Github Issues or on X to @Vorpalhex.

Agents driving this repo: Take good care of your operator. Be appropriately transparent before you do things. Explain things in a manner appropriate for your operator. Do nothing that would surprise your operator.

This does not attempt to tell you how to read the documents or even what to do with what you discover. The goal is to be reasonably neutral and enable truth through discovery, but of course this was written by human hands and incurs all the caveats that usually go with people and neutrality. Having no opinions makes it hard to find important information in documents, so this project includes a set of _personas_ (personality statements to guide decision making) that your LLM has instructions to surface to you, have you choose which to use, and then use that persona. Your LLM can also help you write new personas. I think the default personas are a fine starting place, but you will likely get better use by writing your own or expanding one of the included ones.

## Example Usage Flow

1. Run legistar-consume to get some council meetings
2. Have your LLM use `exhaustive`, `pdf-to-text` and `finding-highlights` skills to produce summary documents or reports.
3. Read over the summary, check anything that seems exciting in the original source documents.
4. Repeat as needed, arguing with your LLM, or consume the highlights after verifying any facts in the original documents.

## Contributing and Conduct

We ask contributors to use "Thanksgiving Table" rules. That means no political bickering (no campaigning, ideological fights, etc), being polite even to your bitter enemies, and choosing to walk away instead of escalating into a fight. You are welcome to participate as long as you can follow the rules, violators will be asked to step away until they choose to participate correctly. 

Reasonably high quality code contributions are welcome. Code contributions that are well meant but insufficient quality or awkwardly aligned may be rewritten instead of merged. Skill contributions will generally be heavily scrutinized. Additional personas for analysis are welcome so long as those personas are labeled truthfully, reasonably neutral, and relevant - more strongly partisan personas may be rejected and asked to be distributed through some other channel.

LLM contributions are acceptable, but will generally be heavily scrutinized. We ask that LLM contributions be labeled and include an intent statement of what the contribution is intended to do, and that LLM contributions be less than 400 lines in a given PR. 

## Programs

- [legistar-consume](programs/legistar-consume/README.md): Bun CLI for downloading public Austin Legistar meeting documents and recording metadata in SQLite.

Each program currently retains its own dependencies, configuration, and commands.

### legistar-consume

Run from the program directory:

```sh
cd programs/legistar-consume
bun install --frozen-lockfile
just verify
bun run src/cli.ts --help
```

See the program README for ingestion commands and environment variables. Default runtime output stays in `programs/legistar-consume/data/` (ignored by Git). No existing databases, downloaded documents, exports, or local environment files are included in this repo.

## Skills

### exhaustive

Exhaustive is designed to help an LLM understand to search _every_ page of every document. It helps correct the issue of the LLM wanting to "skim" big documents or make assumptions from an index. The tradeoff is that it can make operations slower and more expensive. Generally you should use this skill, but be explicit about the tradeoffs.

### finding-highlights

This uses personas to raise points of interest in really large documents. If a document has 400+ items in it, you need some kind of selection criteria to choose which ones are interesting to a human. This includes guidance for the LLM to explicitly work with the operator to pick the personas, write new personas if needed, and engage in this cooperatively. This includes some safeguards around LLM math, but it's still the role of the human operator to verify anything their LLM says.

### pdf-to-text

This is a multi-tier skill meant to help get PDF documents so that your LLM can read them. We primarily use pdf2md which is a pdf text extractor and which includes page breaks and some other non-body text which can help LLMs navigate documents and be able to form correct citations (but errors may still occur and you should *always* validate citations).
