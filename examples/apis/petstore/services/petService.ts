import { HttpRequestAdapter } from "openapi-io-ts/dist/runtime";
import { addPet } from "../operations/addPet";
import { updatePet } from "../operations/updatePet";
import { findPetsByStatus } from "../operations/findPetsByStatus";
import { findPetsByTags } from "../operations/findPetsByTags";
import { getPetById } from "../operations/getPetById";
import { updatePetWithForm } from "../operations/updatePetWithForm";
import { deletePet } from "../operations/deletePet";
import { uploadFile } from "../operations/uploadFile";

export const petServiceBuilder = (requestAdapter: HttpRequestAdapter) => ({
  addPet: addPet(requestAdapter),
  updatePet: updatePet(requestAdapter),
  findPetsByStatus: findPetsByStatus(requestAdapter),
  findPetsByTags: findPetsByTags(requestAdapter),
  getPetById: getPetById(requestAdapter),
  updatePetWithForm: updatePetWithForm(requestAdapter),
  deletePet: deletePet(requestAdapter),
  uploadFile: uploadFile(requestAdapter),
});
