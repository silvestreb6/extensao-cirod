# Assistente CIROD

Extensão Chrome que integra funcionalidades avançadas e automação para otimizar processos no sistema CfazMax para uso exclusivo da CIROD Radiologia.

## Funcionalidades

- **Produtividade dos Dentistas**: Dashboard com métricas e KPIs de produtividade

## Requisitos

- Google Chrome (ou navegador baseado em Chromium)
- Acesso ao sistema [CfazMax](https://max.cfaz.net/)

## Instalação

1. Clone o repositório:
   ```bash
   git clone https://github.com/silvestreb6/extensao-cirod.git
   ```

2. Abra o Chrome e acesse `chrome://extensions/`

3. Ative o **Modo do desenvolvedor** (canto superior direito)

4. Clique em **Carregar sem compactação**

5. Selecione a pasta do projeto

## Estrutura do Projeto

```
├── aws/                    # Configurações AWS
├── css/                    # Estilos
├── images/                 # Ícones e imagens
├── js/
│   ├── backup/             # Scripts de backup e cálculos
│   └── controles/          # Scripts de controles e dashboards
├── utils/                  # Utilitários (Chart.js, logger, etc.)
├── manifest.json           # Configuração da extensão
└── service_worker.js       # Service worker da extensão
```

## Tecnologias

- JavaScript (ES6+)
- Chart.js (visualização de dados)
- Chrome Extensions API (Manifest V3)

## Autor

CIROD Radiologia

## Versão

1.0.0
