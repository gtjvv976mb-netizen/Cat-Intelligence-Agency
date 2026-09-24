/* CashCat's launches, read as a JSON module. Apart from the floor's code on purpose, like
   cases-data.js: a browser that cannot import JSON, or a launches.json that does not parse,
   fails only this import, and the page says the launches could not be read. */
import launches from "./launches.json" with { type: "json" };
export default launches;
