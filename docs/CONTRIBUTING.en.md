# Contributing

<p>
  <b>English</b> · <a href="CONTRIBUTING.md">简体中文</a>
</p>

Thank you for being willing to invest your time and ideas in this project. This is a research-driven personal project, and contributions of all forms are welcome: bug fixes, documentation improvements, tooling enhancements, UI polish, new feature experiments, and secondary development based on this architecture.

## First, Understand the Project Boundaries

This project has a clear research direction—meta-orchestration, organizational structure evolution, and the experience closed loop. The following areas are not recommended for direct PR changes. If you have different ideas, please open an Issue first for discussion:

- The architectural invariants listed in `Architecture.md`;
- The lifecycle semantics of experience and runtime independence;
- The integration boundary with DSH (do not modify the Harness core; collaborate only through official seams);
- The core execution model (parent-agent-driven bounded orchestration, not engine-driven).

**Everything else is open.**

## Submitting PRs

Small, focused PRs are most welcome. Small, focused PRs are easier and faster to process.

For large refactors or feature rewrites, please open an Issue first to discuss. Such PRs may not be merged directly, but I will read and evaluate them carefully and extract the useful parts to integrate into the existing architecture.

The project iterates quickly. You can submit based on the code at the time you forked; you do not need to worry about merge conflicts. I will handle mechanical conflicts; if semantic changes are involved, I will confirm with you in the PR.

## Extend, Rather Than Modify

If you have ideas about the architecture, the most contributor-friendly way to participate is to **fork this repository and do secondary development based on its architecture, or create your own DSH plugin**. You do not need to wait for review; your implementation can immediately serve your own scenarios and continuously sync upstream improvements.

If you discover architectural shortcomings during extension, you are welcome to come back and open an Issue for discussion. Feedback backed by real implementations carries far more weight than abstract design.

## Development and Testing

See the “Local Development” section in [README.md](README.md) for commands to set up the development environment, build, test, and type-check.

Before submitting, please make sure the relevant tests pass; if you add new behavior, please include corresponding tests. Code style and intra-module implementation conventions are described in the `AGENTS.md` files in each directory.

## Finally

Every contributor willing to invest time and effort deserves respect. I will try my best to review every submission carefully, and I look forward to your Issues and PRs.