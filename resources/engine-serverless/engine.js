'use strict';

class ServerlessEngine {
  constructor(serverless, options) {
    this.initialized = false;
    this.serverless = serverless;
    this.options = options;
    this.naming = this.serverless.providers.aws.naming;

    this.hooks = {
      'after:package:setupProviderConfiguration': this.setupProviderConfiguration.bind(this)
    };
  }

  //LOGS
  //this.serverless.cli.log(JSON.stringify(apiGateway))
  //throw new Error(JSON.stringify(this.api))

  initializeVariables() {
    if (!this.initialized) {
      const awsCreds = Object.assign({}, this.serverless.providers.aws.getCredentials(), { region: this.serverless.service.provider.region })

      this.apiGateway = new this.serverless.providers.aws.sdk.APIGateway(awsCreds)
      this.cloudFormation = new this.serverless.providers.aws.sdk.CloudFormation(awsCreds)
      this.lambda = new this.serverless.providers.aws.sdk.Lambda(awsCreds)
      this.acm = new this.serverless.providers.aws.sdk.ACM(awsCreds)
      this.route53 = new this.serverless.providers.aws.sdk.Route53(awsCreds)
      this.s3 = new this.serverless.providers.aws.sdk.S3(awsCreds)
      this.cloudFront = new this.serverless.providers.aws.sdk.CloudFront(awsCreds)
      this.ssm = new this.serverless.providers.aws.sdk.SSM(awsCreds)
      this.resourcesCloudFormation = {}

      this.initialized = true
    }
  }

  async setupProviderConfiguration(){
    this.initializeVariables()

    await this.manipulateResources()
  }

  //Esse metodo eh responsavel por criar/referenciar resources/apigateway
  async manipulateResources() {

    this.initializeVariables()

    //const JSON = require('circular-json')
    this.apiName = this.serverless.service.provider.apiName
    this.moduloName = this.serverless.service.provider.moduloName
    this.stackName = this.serverless.service.provider.stackName

    console.log(this.apiName + '-' + this.moduloName + '-' + this.stackName)

    if(!this.apiName){
      this.serverless.cli.log(`ApiName não informada`)
      return
    }

    //Conseguindo informacoes das stacks geradas
    let cloudFormationTemplate = {}
    let cloudFormationTemplateAlias = {}

    try {
      let {TemplateBody} = await this.cloudFormation.getTemplate({
        "StackName": this.apiName + '-' + this.moduloName + '-' + this.stackName
      }).promise()
      cloudFormationTemplate = JSON.parse(TemplateBody).Resources
    }catch(e){
      this.serverless.cli.log('Stack não criada');
    }

    try {
      let {TemplateBody} = await this.cloudFormation.getTemplate({
        "StackName": this.apiName + '-' + this.moduloName + '-' + this.stackName + '-' + this.serverless.service.provider.stage
      }).promise()
      cloudFormationTemplateAlias = JSON.parse(TemplateBody).Resources
    }catch(e){
      this.serverless.cli.log('Stack não criada');
    }

    Object.keys(cloudFormationTemplate).forEach (key => {
      if(cloudFormationTemplate[key].Type == "AWS::ApiGateway::Resource"  ||
        cloudFormationTemplate[key].Type == "AWS::ApiGateway::RestApi"    ||
        cloudFormationTemplate[key].Type == "AWS::ApiGateway::Authorizer" ||
        cloudFormationTemplate[key].Type == "AWS::ApiGateway::BasePathMapping"){
        this.resourcesCloudFormation[key] = cloudFormationTemplate[key]
      }
    })

    Object.keys(cloudFormationTemplateAlias).forEach (key => {
      if(cloudFormationTemplateAlias[key].Type == "AWS::ApiGateway::Resource"  ||
        cloudFormationTemplateAlias[key].Type == "AWS::ApiGateway::RestApi"    ||
        cloudFormationTemplateAlias[key].Type == "AWS::ApiGateway::Authorizer"      ||
        cloudFormationTemplateAlias[key].Type == "AWS::ApiGateway::BasePathMapping"){
        this.resourcesCloudFormation[key] = cloudFormationTemplateAlias[key]
      }
    })

    //Conseguindo a lista de apis
    const {items} = await this.apiGateway.getRestApis({limit:1000}).promise()

    //Verificando se existe a API
    this.api = items.filter(api => api.name === this.apiName)

    //Paths ja existentes
    let resources = []

    let apiGateway = Object.keys(this.resourcesCloudFormation).reduce((arr, key) => {
      if (this.resourcesCloudFormation[key].Type === 'AWS::ApiGateway::RestApi') {
        arr.push(this.resourcesCloudFormation[key])
      }
      return arr
    }, [])

    //A Api já existe so se faz necessario realizar a referencia
    // e o resource de criacao da API esta em outra stack
    if (this.api.length == 1 && apiGateway.length == 0){
      this.api = this.api[0]
      //Adicionando a referencia caso a mesma ja exista na referencia cross stack (outputs no momento da criacao)
      this.serverless.service.provider.apiGateway = {
        "restApiId": this.api.id
      }

      //conseguindo os path ja criados
      let hasMoreResults = true
      let currentPosition = null
      //conseguindo todos os resources da api
      do {
        const {position, items} = await this.apiGateway.getResources({position: currentPosition, restApiId: this.api.id, limit: 500}).promise()
        resources = resources.concat(items)
        currentPosition = position
        hasMoreResults = position && items.length === 500
      } while (hasMoreResults)

      this.apiResources = resources

      //Se nao existir o resource no json, cria para adicionar as opcoes dentro dele
      if(!this.serverless.service.provider.apiGateway.hasOwnProperty('restApiResources')){
        this.serverless.service.provider.apiGateway = Object.assign(this.serverless.service.provider.apiGateway,{"restApiResources":{}})
      }

      let paths = []
      Object.keys(this.serverless.service.functions).forEach (fn => {
        let func = this.serverless.service.functions[fn]
        func.events.forEach (event => {
          if(event.http){
            let path = event.http.path
            let resourceInAWS

            do{
              resourceInAWS = resources.filter(res => res.path === `/${path}`)[0]
              path = path.split('/')
              path.pop()
              path = path.join('/')
            } while(resourceInAWS === undefined)

            //conseguindo todos os partial paths que compoe esse path
            paths.push(resourceInAWS)
            let parentIdRaiz = resourceInAWS.parentId
            while (true){
              const res = resources.filter((resource) => resource.id === parentIdRaiz)[0]
              if(!res) break
              parentIdRaiz = res.parentId

              if(!paths.includes((p) => p.id === res.id)){
                paths.push(res)
              }
            }
          }
        })
      })

      paths = [...new Set(paths)]

      //Agora removo os recursos que devem ser criados nesse cloudformation
      //Caso o meu cloudFormation possua esse resource (isso significa que o recurso foi criado nesse CloudFormation) eu nao posso referenciar, pois o mesmo eh apagado
      //Por isso removo do meu array de paths
      for (let i = 0; i < paths.length; ++i){
        // console.log(paths[i])
        for (const key of Object.keys(this.resourcesCloudFormation)) {
          //Utilizo o parent id e o pathPart pois não tenho acesso ao id dentro do resourcesCloudFormation
          const parentId = this.resourcesCloudFormation[key].Properties.ParentId
          const pathPart = this.resourcesCloudFormation[key].Properties.PathPart
          if(pathPart && pathPart == paths[i].pathPart && (parentId == paths[i].parentId || (parentId.Ref && this.resourcesCloudFormation[parentId.Ref] ))){
            paths.splice(i--, 1)
            break
          }
        }
      }

      for (const path of paths.reverse()){
        if(path.path == "/"){
          this.serverless.service.provider.apiGateway = Object.assign(this.serverless.service.provider.apiGateway, {
            "restApiRootResourceId": path.id
          })
        }else{
          this.serverless.service.provider.apiGateway.restApiResources = Object.assign(this.serverless.service.provider.apiGateway.restApiResources,
          {
            [path.path.substr(1,path.path.length)]: path.id
          })
        }
      }

    //A Api não existe criar uma adicionando o json diretamente no serverless.yml
    //Juntamente com o outpu para o funcionamento da funcao "Fn::ImportValue" em outras stacks
    }else{

      this.api = false

      //Criando as opções dentro do objeto caso não exista
      if(!this.serverless.service.resources) {
        this.serverless.service.resources = {"Resources":{},"Outputs":{}}
      }

      // Adicionando o resource de criacao da API
      // Resource de criação do requestValidator
      this.serverless.service.resources.Resources = Object.assign(this.serverless.service.resources.Resources,
      {
        "ApiGatewayRestApi": {
          "Type": "AWS::ApiGateway::RestApi",
          "Properties": {
            "Name": this.apiName,
            "Description": "API com as funcionalidades da " + this.apiName,
            "EndpointConfiguration": {
              "Types": [
                "EDGE"
              ]
            },
            "Policy": {
              "Version": "2012-10-17",
              "Statement": [
                {
                  "Effect": "Allow",
                  "Principal": "*",
                  "Action": "execute-api:Invoke",
                  "Resource": [
                    "execute-api:/*/*/*"
                  ]
                }
              ]
            }
          }
        },
        "RequestValidatorBody": {
          "Type": "AWS::ApiGateway::RequestValidator",
          "Properties": {
            "Name": "body",
            "RestApiId": {
              "Ref": "ApiGatewayRestApi"
            },
            "ValidateRequestBody": true,
            "ValidateRequestParameters": false
          }
        },
        "RequestValidatorParams": {
          "Type": "AWS::ApiGateway::RequestValidator",
          "Properties": {
            "Name": "params",
            "RestApiId": {
              "Ref": "ApiGatewayRestApi"
            },
            "ValidateRequestBody": false,
            "ValidateRequestParameters": true
          }
        },
        "RequestValidatorBodyParams": {
          "Type": "AWS::ApiGateway::RequestValidator",
          "Properties": {
            "Name": "body-and-params",
            "RestApiId": {
              "Ref": "ApiGatewayRestApi"
            },
            "ValidateRequestBody": true,
            "ValidateRequestParameters": true
          }
        },
      })
    }
  }
}

module.exports = ServerlessEngine;
