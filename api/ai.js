import { handleAI } from "../server/ai.js";
import { productionApi } from "../server/productionApi.js";

export default productionApi(handleAI);
