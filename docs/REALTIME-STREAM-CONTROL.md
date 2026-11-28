# Realtime stream control

Wave 6 adds a priority model to SDPN's interactive session routing so control traffic cannot be
trapped behind bulk conversational output.

## Priority lanes

```text
priority 0  CONTROL
  cancel / ack / ping / pong / response lifecycle / error

priority 1  INTERACTIVE
  tool calls / events / input commits / state-oriented frames

priority 2  STREAM
  input.delta / output.delta / audio chunks
```

The route planner classifies these as:

- `INTERACTIVE_CONTROL`
- `INTERACTIVE_BUFFERED`
- `INTERACTIVE_STREAM`
- `REFERENCE`
- `PORTABLE_BUFFERED`

Planning still returns `executed=false`; classification is not evidence of network execution.

## Barge-in invariant

A cancel/control frame is accepted even when the normal in-flight acknowledgement window is full.
This prevents the user from being unable to interrupt Kindred because Kindred is already streaming
too much output.

## Production scaling

The same separation is useful beyond conversation. High-priority governance/control frames remain
small and independent from high-volume data or generated-output traffic. That lets new capability
lanes scale without redefining the authority/control plane.

The intended production pattern is:

```text
stable control contract
      +
replaceable capability implementations
      +
independent transport lanes
      +
automated tests
      =
higher parallel production without increasing core concepts
```
