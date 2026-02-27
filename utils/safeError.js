const isProduction = () => process.env.NODE_ENV === 'production';

const clientMessage = (error, fallbackMessage) => {
  if (isProduction()) {
    return fallbackMessage;
  }

  return error?.message || fallbackMessage;
};

const sendServerError = (res, error, fallbackMessage) =>
  res.status(500).json({
    message: clientMessage(error, fallbackMessage),
  });

module.exports = {
  clientMessage,
  sendServerError,
};
