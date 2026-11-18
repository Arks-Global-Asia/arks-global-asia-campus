import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
export class AzureBlobBucket {
  constructor(env) {
    this.env = env;
    this.container = null;
  }
  getContainer() {
    if (!this.container) {
      let client;
      if (this.env.PORTAL_BLOB_CONNECTION_STRING)
        client = BlobServiceClient.fromConnectionString(
          this.env.PORTAL_BLOB_CONNECTION_STRING,
        );
      else if (this.env.PORTAL_BLOB_ACCOUNT)
        client = new BlobServiceClient(
          "https://" + this.env.PORTAL_BLOB_ACCOUNT + ".blob.core.windows.net",
          new DefaultAzureCredential(),
        );
      else
        throw Object.assign(
          Error("Campus file storage has not been configured."),
          { status: 503 },
        );
      this.container = client.getContainerClient(
        this.env.PORTAL_BLOB_CONTAINER || "campus-private",
      );
    }
    return this.container;
  }
  blob(id) {
    if (!/^[\w-]{1,200}$/.test(id))
      throw Object.assign(Error("Invalid file ID."), { status: 400 });
    return this.getContainer().getBlockBlobClient(id);
  }
  async put(id, value) {
    const bytes = Buffer.from(value);
    await this.blob(id).uploadData(bytes, {
      blobHTTPHeaders: { blobContentType: "application/octet-stream" },
    });
  }
  async get(id) {
    try {
      const bytes = await this.blob(id).downloadToBuffer();
      return { body: new Uint8Array(bytes) };
    } catch (e) {
      if (e.statusCode === 404) return null;
      throw Object.assign(Error("Campus file storage could not be reached."), {
        status: 503,
      });
    }
  }
  async delete(id) {
    await this.blob(id).deleteIfExists();
  }
}
