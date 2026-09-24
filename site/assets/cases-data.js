/* The case file, read as a JSON module. It sits apart from the floor's code on purpose: a
   browser that cannot import JSON, or a cases.json with a syntax error, fails only this import.
   The floor catches that, keeps every station working, and says it could not read the cases. */
import cases from "./cases.json" with { type: "json" };
export default cases;
