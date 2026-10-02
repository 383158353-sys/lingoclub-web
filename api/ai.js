import { handleAI } from "../server/ai.js";
import { productionApi } from "../server/productionApi.js";
import { sendAIError } from "../server/aiErrorResponse.js";

export default productionApi(handleAI, (res, error, body) => sendAIError(res, error, { task: body?.task, credentialId: body?.credential_id }));
