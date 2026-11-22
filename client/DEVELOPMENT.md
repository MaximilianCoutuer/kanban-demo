# Client development

Run `npm ci` and `npm start` in `client`. The board is available at
http://localhost:4200 and proxies `/api` to the API at http://localhost:5000.
Start the API separately. Run `npm run build` and `npm test` to validate.

Angular 21 supports Node 20, 22 and 24 LTS (see Angular's version compatibility
table for minimum versions). Node 25 is not in Angular 21's supported versions;
it is an odd-numbered, non-LTS release, and the CLI warns against production use.
