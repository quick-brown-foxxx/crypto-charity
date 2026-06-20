/** Compile-time-only assignability assertion for frontend API schemas. */
export type AssertAssignable<Actual extends Expected, Expected> = Actual extends Expected
  ? true
  : never;
