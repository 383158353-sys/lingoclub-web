import { handleYouTubeTranscript } from "../server/youtubeTranscript.js";
import { productionApi } from "../server/productionApi.js";

export default productionApi(handleYouTubeTranscript);
