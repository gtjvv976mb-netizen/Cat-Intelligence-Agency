/* THE AGENCY'S ONE CONFIG: every value the site cannot know yet.
   Leave a value "" until it exists. An empty value renders as clearly empty (a disabled
   button, an empty slot), never as a made-up value or a dead link. home.js checks each value
   before it uses it and ignores one that does not look right.

   xUrl             the agency's X profile, once the handle is claimed: https://x.com/<handle>
   contractAddress  the $CIA mint address, only after launch, and only the one posted on X
   buyUrl           the pump.fun page for that same mint, only after launch */
window.CIA_CONFIG = {
  xUrl: "",
  contractAddress: "",
  buyUrl: "",
};
