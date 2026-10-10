import { handleFetchVideoMeta } from "../server/fetchVideoMeta.js";
import { productionApi } from "../server/productionApi.js";

export default productionApi(handleFetchVideoMeta);
