# iOS: fix build — unfurl width expression timed out the type checker

- `[ios]` `unfurlImageWidth` (#307) was one literal-heavy expression that the
  Swift compiler refused to type-check "in reasonable time", breaking the
  iOS build. Split into named sub-expressions; no behaviour change.
