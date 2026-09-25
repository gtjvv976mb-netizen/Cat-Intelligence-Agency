/* Popcat's file (every cat coin it checked, and its picks), read as a JSON module. Apart from
   the floor's code on purpose, like cases-data.js: a browser that cannot import JSON, or a
   callouts.json that does not parse, fails only this import, and the page says Popcat's file
   could not be read. */
import callouts from "./callouts.json" with { type: "json" };
export default callouts;
