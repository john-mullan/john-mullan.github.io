const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const source = fs.readFileSync(
  __dirname + "/google_calendar_scaffold.gs", "utf8"
) + "\nthis.readWebsiteMetadata_ = readWebsiteMetadata_;" +
  "\nthis.updateWebsiteMetadata_ = updateWebsiteMetadata_;";
const context = {console};
vm.createContext(context);
vm.runInContext(source, context);

assert.deepStrictEqual(
  {...context.readWebsiteMetadata_("--- Website ---\nensemble: The Thirteen\ndetails: https://example.com")},
  {ensemble: "The Thirteen", details: "https://example.com"}
);

assert.strictEqual(
  context.updateWebsiteMetadata_(
    "A private note\n\n--- Website ---\nensemble:\ndetails:",
    "Ars Populi",
    "https://example.com/tickets"
  ),
  "A private note\n\n--- Website ---\nensemble: Ars Populi\ndetails: https://example.com/tickets"
);

assert.strictEqual(
  context.updateWebsiteMetadata_(
    "title: Public title\ntickets: https://old.example\nensembleUrl: https://ensemble.example",
    "New Ensemble",
    "https://new.example"
  ),
  "title: Public title\nensembleUrl: https://ensemble.example\n\n--- Website ---\n" +
    "ensemble: New Ensemble\ndetails: https://new.example"
);

console.log("google_calendar_scaffold helpers passed");
