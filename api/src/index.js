import { app } from "@azure/functions";
import { handleAzureRequest } from "./handler.js";
app.http("campus", {
  methods: ["GET", "POST", "HEAD"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: (request) => handleAzureRequest(request),
});
