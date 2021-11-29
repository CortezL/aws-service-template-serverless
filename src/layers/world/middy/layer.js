"use strict"

class layer {
  //Criação do singleton
  constructor() {
    if (!layer.instance) {
      layer.instance = this
    }

    return layer.instance
  }

  async exampleFunction() {

    /**
     *
     * Definição das funcionalidades...
     *
     **/

    return {
      "status":"SUCCESS",
      "msg":"Exemplo da criação de um layer"
    }
  }
}

module.exports = new layer()
