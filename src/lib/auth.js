module.exports = {
    isLoggedIn(req, res, next) {
        if (req.isAuthenticated()) {
            return next();
        }
        return res.redirect('/signin');
    },

    isLoggedInAdmin(req, res, next) {
        if (req.isAuthenticated()) {
            // Verificar si el usuario tiene un tipo específico
            if (req.user.tipo === 1) {
                return next();
            } else {
                // Redireccionar a una página de acceso no autorizado si el usuario no es un administrador
                return res.redirect('/');
            }
        }
        return res.redirect('/signin');
    },

    isNotLoggedIn(req, res, next) {
        if (!req.isAuthenticated()) {
            return next();
        }
        return res.redirect('/');
    }

}