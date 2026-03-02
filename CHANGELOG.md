# Changelog

All notable changes to this project are documented in this file.

## [1.0.8] - 2026-03-02

### Added
- `Address Map` floating panel with wider table layout.
- `Export CSV` action for Address Map table.
- Left-edge graphical indicator for hidden sidebar discovery.
- `F` keyboard shortcut to fit and center the diagram viewport.

### Changed
- Default layout direction kept as left-to-right (`RIGHT`).
- Left sidebar made compact and auto-hidden shortly after startup.
- Right inspector panel made compact and auto-dismiss behavior set to 5 seconds.
- Main canvas container updated to a flatter visual style.
- README updated with latest usage and feature guidance.

### Improved
- Address metadata extraction from Qsys connections now includes:
  - base address
  - inferred end address (when available)
  - computed range text for table/export
- Extension manifest cleanup for release readiness (removed redundant activation event declaration).

## [1.0.7] - 2026-03-02

### Added
- Initial compact UI and inspector improvements.
- Basic README usage/shortcut documentation.
