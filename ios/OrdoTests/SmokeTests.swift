import Testing

@Suite struct SmokeTests {
    @Test func truth() { #expect(Bool(true)) }
}
