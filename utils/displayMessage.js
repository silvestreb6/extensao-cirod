/**
 * Exibe uma mensagem para o usuário de forma genérica e reutilizável.
 * @param {string} message - A mensagem a ser exibida.
 * @param {string} type - O tipo da mensagem ('success', 'error', 'required', 'requiredPersistent', etc.).
 * @param {string} selector - O seletor do elemento DOM usado como referência.
 * @param {string} position - A posição da mensagem em relação ao elemento ('above', 'below', 'left', 'right').
 */
function displayMessageToUser(message, type, selector, position = "above") {
  // Seleciona o elemento de referência no DOM
  const referenceElement = document.querySelector(selector);
  if (!referenceElement) {
    console.error(
      `Elemento de referência não encontrado para o seletor: ${selector}`
    );
    return;
  }

  // Cria o contêiner da mensagem
  const messageContainer = document.createElement("div");
  messageContainer.textContent = message;
  messageContainer.style.position = "absolute";
  messageContainer.style.zIndex = "500";
  messageContainer.style.fontWeight = "bold";
  messageContainer.style.padding = "10px";
  messageContainer.style.borderRadius = "4px";
  messageContainer.style.maxWidth = "400px";
  messageContainer.style.wordWrap = "break-word";
  messageContainer.style.boxShadow = "0px 4px 6px rgba(0, 0, 0, 0.1)";

  // Define estilos com base no tipo de mensagem
  switch (type) {
    case "success":
      messageContainer.style.color = "green";
      messageContainer.style.backgroundColor = "#e6ffe6";
      messageContainer.style.border = "1px solid green";
      break;
    case "error":
      messageContainer.style.color = "red";
      messageContainer.style.backgroundColor = "#ffe6e6";
      messageContainer.style.border = "1px solid red";
      break;
    case "required":
    case "requiredPersistent":
      messageContainer.style.color = "#E79824";
      messageContainer.style.backgroundColor = "#fcecd6";
      messageContainer.style.border = "1px solid #E79824";
      break;
    case "blocked":
      messageContainer.style.color = "#A55B00";
      messageContainer.style.backgroundColor = "#FFF5E6";
      messageContainer.style.border = "1px solid #A55B00";
      break;
    default:
      messageContainer.style.color = "#333";
      messageContainer.style.backgroundColor = "#f4f4f4";
      messageContainer.style.border = "1px solid #ccc";
      break;
  }

  // Insere o elemento no DOM
  document.body.appendChild(messageContainer);

  // Calcula a posição da mensagem em relação ao elemento de referência
  const rect = referenceElement.getBoundingClientRect();
  const messageRect = messageContainer.getBoundingClientRect();

  switch (position) {
    case "above":
      messageContainer.style.top = `${
        window.scrollY + rect.top - messageRect.height - 10
      }px`;
      messageContainer.style.left = `${window.scrollX + rect.left}px`;
      break;
    case "below":
      messageContainer.style.top = `${window.scrollY + rect.bottom + 10}px`;
      messageContainer.style.left = `${window.scrollX + rect.left}px`;
      break;
    case "left":
      messageContainer.style.top = `${window.scrollY + rect.top}px`;
      messageContainer.style.left = `${
        window.scrollX + rect.left - messageRect.width - 10
      }px`;
      break;
    case "right":
      messageContainer.style.top = `${window.scrollY + rect.top}px`;
      messageContainer.style.left = `${window.scrollX + rect.right + 10}px`;
      break;
    default:
      console.error(`Posição inválida: ${position}`);
      break;
  }

  // Atualiza o trecho para atender ao requisito de persistência e saída suave
  if (!type.includes("Persistent")) {
    setTimeout(() => {
      // Adiciona a animação de saída suave
      messageContainer.style.transition = "transform 0.5s, opacity 0.5s";
      messageContainer.style.transform = "translateX(-20px)";
      messageContainer.style.opacity = "0";

      // Remove o elemento após a animação
      setTimeout(() => {
        if (messageContainer.parentNode) {
          messageContainer.parentNode.removeChild(messageContainer);
        }
      }, 500); // Aguarda o término da animação (500ms)
    }, 5000); // Mensagem visível por 5 segundos
  }
}

// Torna a função acessível globalmente
window.displayMessageToUser = displayMessageToUser;
